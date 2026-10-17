//! Verification build for the journaled save scheme.
//!
//!   lab sim                 crash at every op of many scenarios (simulated disk)
//!   lab external            outside changes are never overwritten
//!   lab diskfull            a full disk never touches the manuscript
//!   lab real <dir>          crash at every op on the real disk (child processes)
//!   lab bench <dir>         save cost: current Then / expert scheme / this scheme

mod fs;
mod journal;

use fs::{Fs, RealFs, Rng, SimFs};
use journal::{recover, sha, DiskClass, Journal, SaveError};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

const ALPHABET: &[&str] = &["あ", "い", "う", "漢", "字", "テ", "ス", "ト", "。", "、", "a", "b", "\n", "「", "」"];

fn random_text(rng: &mut Rng, chars: usize) -> Vec<u8> {
    let mut s = String::new();
    for _ in 0..chars {
        s.push_str(ALPHABET[rng.below(ALPHABET.len() as u64) as usize]);
    }
    s.into_bytes()
}

/// A random insert/delete at character boundaries, as an editor would make.
fn random_edit(content: &[u8], rng: &mut Rng) -> (usize, usize, Vec<u8>) {
    let text = std::str::from_utf8(content).expect("utf-8 text");
    let mut bounds: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    bounds.push(text.len());
    let at = rng.below(bounds.len() as u64) as usize;
    let del_chars = (rng.below(4) as usize).min(bounds.len() - 1 - at);
    let n = rng.below(7) as usize;
    let ins = random_text(rng, n);
    let (pos, end) = (bounds[at], bounds[at + del_chars]);
    if end == pos && ins.is_empty() {
        return (pos, 0, "x".as_bytes().to_vec());
    }
    (pos, end - pos, ins)
}

#[derive(Default, Clone)]
struct Trace {
    /// Text at each generation; hist[0] is the file before Then touched it.
    hist: Vec<Vec<u8>>,
    logged_gen: u64,
    durable_gen: u64,
    started: bool,
    saves: u64,
    compactions: u64,
    /// A save failed but the manuscript bytes changed anyway.
    touched_on_failure: u64,
}

/// Edits, background flushes and saves in a seeded order.
fn scenario<F: Fs>(fs: &mut F, dir: &Path, doc: &Path, seed: u64, steps: usize, tr: &mut Trace) -> Option<Journal> {
    let mut rng = Rng::new(seed);
    let mut j = Journal::start(fs, dir, doc).ok()?;
    tr.started = true;
    for _ in 0..steps {
        if fs.dead() {
            return Some(j);
        }
        match rng.below(20) {
            0..=13 => {
                let (pos, del, ins) = random_edit(&j.content, &mut rng);
                let _ = j.edit(fs, pos, del, &ins);
                tr.hist.push(j.content.clone());
            }
            14..=15 => {
                let _ = j.flush(fs);
            }
            _ => {
                let before = fs.read(doc).ok();
                let result = j.save(fs);
                if fs.dead() {
                    return Some(j);
                }
                match result {
                    Ok(true) => tr.saves += 1,
                    Err(SaveError::Journal(_)) | Err(SaveError::External(_)) => {
                        if fs.read(doc).ok() != before {
                            tr.touched_on_failure += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
        tr.logged_gen = j.logged_gen;
        tr.durable_gen = j.durable_gen;
        tr.compactions = j.stats.compactions;
    }
    Some(j)
}

fn sim_setup(init: &[u8], doc: &Path) -> SimFs {
    let mut fs = SimFs::default();
    fs.put_durable(doc, init);
    fs
}

#[derive(Clone, Copy, Debug)]
enum Mode {
    AppCrash,
    AppCrashMidWrite,
    PowerLoss(u64),
}

#[derive(Default)]
struct Tally {
    runs: u64,
    failures: Vec<String>,
    classes: BTreeMap<String, u64>,
    no_journal: u64,
    continued: u64,
    lost_beyond_required: u64,
    compactions_seen: u64,
}

fn check_run(fs: &mut SimFs, dir: &Path, doc: &Path, tr: &Trace, mode: Mode, label: &str, tally: &mut Tally) {
    tally.runs += 1;
    let required = match mode {
        Mode::PowerLoss(_) => tr.durable_gen,
        _ => tr.logged_gen,
    };
    let before = fs.peek(doc);
    let fail = |tally: &mut Tally, why: String| tally.failures.push(format!("{label} {mode:?}: {why}"));
    if before.is_none() {
        return fail(tally, "manuscript missing after crash".into());
    }
    let recovered = match recover(fs, dir, doc) {
        Ok(r) => r,
        Err(e) => return fail(tally, format!("recover error {e:?}")),
    };
    if fs.peek(doc) != before {
        return fail(tally, "recovery wrote to the manuscript".into());
    }
    let Some(r) = recovered else {
        tally.no_journal += 1;
        if required != 0 || before.as_deref() != Some(&tr.hist[0][..]) {
            fail(tally, format!("no journal but required gen {required}"));
        }
        return;
    };
    if !r.replay_ok {
        return fail(tally, "replay stopped on a bad record".into());
    }
    if r.gen < required {
        return fail(tally, format!("recovered gen {} < required {}", r.gen, required));
    }
    if r.gen as usize >= tr.hist.len() || r.content != tr.hist[r.gen as usize] {
        return fail(tally, format!("recovered text is not generation {}", r.gen));
    }
    if r.gen > required {
        tally.lost_beyond_required += 0;
    }
    if matches!(r.class, DiskClass::Unknown | DiskClass::IdMismatch | DiskClass::Missing) {
        return fail(tally, format!("crash-only run classified as {:?}", r.class));
    }
    if r.base_gen > 0 {
        tally.compactions_seen += 1;
    }
    *tally.classes.entry(format!("{:?}", r.class)).or_default() += 1;

    // Then puts the text back as unsaved; when the disk is in a known state the
    // next save goes through as usual.
    if matches!(r.class, DiskClass::Completed | DiskClass::NotStarted) {
        let names = fs.list(dir).unwrap_or_default();
        for name in names {
            let _ = fs.remove(&dir.join(name));
        }
        let Ok(mut j) = Journal::start(fs, dir, doc) else {
            return fail(tally, "restart failed".into());
        };
        let len = j.content.len();
        if j.edit(fs, 0, len, &r.content).is_err() || j.save(fs).is_err() {
            return fail(tally, "save after recovery failed".into());
        }
        if fs.peek(doc).as_deref() != Some(&r.content[..]) {
            return fail(tally, "manuscript after recovery save differs".into());
        }
        tally.continued += 1;
    }
}

fn cmd_sim(scenarios: u64, steps: usize) {
    let dir = Path::new("/appdata/recovery/doc1");
    let doc = Path::new("/novel/chapter1.md");
    let modes = [Mode::AppCrash, Mode::AppCrashMidWrite, Mode::PowerLoss(1), Mode::PowerLoss(2), Mode::PowerLoss(3), Mode::PowerLoss(4)];
    let mut tally = Tally::default();
    let started = Instant::now();
    let mut total_ops = 0;
    for s in 0..scenarios {
        let seed = 1000 + s;
        let mut rng = Rng::new(seed ^ 0xabcdef);
        let n = 20 + rng.below(400) as usize;
        let init = random_text(&mut rng, n);
        let ops = {
            let mut fs = sim_setup(&init, doc);
            let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
            scenario(&mut fs, dir, doc, seed, steps, &mut tr);
            fs.ops
        };
        total_ops += ops;
        for n in 1..=ops {
            for mode in modes {
                let mut fs = sim_setup(&init, doc);
                fs.crash_at = Some(n);
                fs.partial = matches!(mode, Mode::AppCrashMidWrite);
                let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
                scenario(&mut fs, dir, doc, seed, steps, &mut tr);
                match mode {
                    Mode::PowerLoss(k) => fs.power_loss(&mut Rng::new(seed * 7919 + n * 31 + k)),
                    _ => fs.app_crash(),
                }
                check_run(&mut fs, dir, doc, &tr, mode, &format!("seed {seed} op {n}"), &mut tally);
            }
        }
    }
    println!("sim: {scenarios} scenarios x {steps} steps, {total_ops} crash points, {} runs in {:.1}s", tally.runs, started.elapsed().as_secs_f64());
    println!("  disk state found at recovery: {:?}", tally.classes);
    println!("  runs that recovered from a compacted segment: {}", tally.compactions_seen);
    println!("  runs where Then saved again after recovery: {}", tally.continued);
    println!("  crashes before the journal existed: {}", tally.no_journal);
    report(&tally.failures);
}

fn report(failures: &[String]) {
    if failures.is_empty() {
        println!("  FAILURES: 0");
    } else {
        println!("  FAILURES: {}", failures.len());
        for f in failures.iter().take(20) {
            println!("    {f}");
        }
        std::process::exit(1);
    }
}

fn cmd_external() {
    let dir = Path::new("/appdata/recovery/doc1");
    let doc = Path::new("/novel/chapter1.md");
    let tmp = Path::new("/novel/chapter1.md.sync-tmp");
    let mut failures = Vec::new();
    let init = "第一章\n".as_bytes().to_vec();

    // Each case: (name, outside change, expected save error, expected class after a power cut)
    type Change = fn(&mut SimFs, &Path, &Path, &[u8]);
    let in_place: Change = |fs, doc, _tmp, _cur| {
        let mut data = fs.peek(doc).unwrap();
        data.extend_from_slice("（別PCで追記）".as_bytes());
        fs.put_durable(doc, &data);
    };
    let replaced_other: Change = |fs, doc, tmp, _cur| {
        fs.create_write(tmp, "同期で置き換えた本文".as_bytes()).unwrap();
        fs.rename(tmp, doc).unwrap();
        fs.app_crash();
    };
    let replaced_same: Change = |fs, doc, tmp, _cur| {
        let same = fs.peek(doc).unwrap();
        fs.create_write(tmp, &same).unwrap();
        fs.rename(tmp, doc).unwrap();
        fs.app_crash();
    };
    let cases: [(&str, Change, &str, DiskClass); 3] = [
        ("in-place edit by another app", in_place, "content changed", DiskClass::Unknown),
        ("file replaced with other text", replaced_other, "file identity changed", DiskClass::IdMismatch),
        ("file replaced with the same text", replaced_same, "file identity changed", DiskClass::IdMismatch),
    ];
    for (name, change, want_err, want_class) in cases {
        let mut fs = sim_setup(&init, doc);
        let mut j = Journal::start(&mut fs, dir, doc).unwrap();
        j.edit(&mut fs, init.len(), 0, "一行目。".as_bytes()).unwrap();
        j.save(&mut fs).unwrap();
        let cur = j.content.clone();
        change(&mut fs, doc, tmp, &cur);
        let outside = fs.peek(doc).unwrap();
        j.edit(&mut fs, 0, 0, "★".as_bytes()).unwrap();
        match j.save(&mut fs) {
            Err(SaveError::External(why)) if why == want_err => {}
            other => failures.push(format!("{name}: save returned {other:?}")),
        }
        if fs.peek(doc).unwrap() != outside {
            failures.push(format!("{name}: manuscript was overwritten"));
        }
        j.flush(&mut fs).unwrap();
        fs.power_loss(&mut Rng::new(5));
        let after_cut = fs.peek(doc).unwrap();
        match recover(&mut fs, dir, doc) {
            Ok(Some(r)) => {
                if r.class != want_class {
                    failures.push(format!("{name}: class {:?}, wanted {want_class:?}", r.class));
                }
                if r.content != j.content {
                    failures.push(format!("{name}: recovered text lost the latest edit"));
                }
            }
            other => failures.push(format!("{name}: recover returned {:?}", other.map(|o| o.map(|r| r.class)))),
        }
        if fs.peek(doc).unwrap() != after_cut {
            failures.push(format!("{name}: recovery wrote to the manuscript"));
        }
        println!("external: {name}: save refused, manuscript kept");
    }
    report(&failures);
}

fn cmd_diskfull(scenarios: u64, steps: usize) {
    let dir = Path::new("/appdata/recovery/doc1");
    let doc = Path::new("/novel/chapter1.md");
    let mut failures = Vec::new();
    let mut runs = 0;
    for s in 0..scenarios {
        let seed = 5000 + s;
        let mut rng = Rng::new(seed);
        let n = 50 + rng.below(300) as usize;
        let init = random_text(&mut rng, n);
        let growth = {
            let mut fs = sim_setup(&init, doc);
            let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
            scenario(&mut fs, dir, doc, seed, steps, &mut tr);
            fs.growth_ops
        };
        for n in 1..=growth {
            runs += 1;
            let mut fs = sim_setup(&init, doc);
            fs.fail_growth_from = Some(n);
            let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
            let j = scenario(&mut fs, dir, doc, seed, steps, &mut tr);
            if tr.touched_on_failure > 0 {
                failures.push(format!("seed {seed} full from op {n}: a refused save changed the manuscript"));
            }
            // Space comes back: the queued records drain and the next save lands.
            fs.fail_growth_from = None;
            if let Some(mut j) = j {
                let saved = j.flush(&mut fs).is_ok() && j.save(&mut fs).is_ok();
                if !saved || fs.peek(doc).as_deref() != Some(&j.content[..]) {
                    failures.push(format!("seed {seed} full from op {n}: save after space returned failed"));
                }
            }
        }
    }
    println!("diskfull: {runs} runs (disk full from every growing op of {scenarios} scenarios)");
    report(&failures);
}

// ---------------------------------------------------------------- real disk

const REAL_STEPS: usize = 60;

fn real_init(seed: u64) -> Vec<u8> {
    let mut rng = Rng::new(seed ^ 0x5eed);
    random_text(&mut rng, 3000)
}

fn cmd_real_child(run: &Path, crash_at: u64, seed: u64) {
    let mut fs = RealFs { crash_at: Some(crash_at), ..Default::default() };
    let mut tr = Trace { hist: vec![real_init(seed)], ..Default::default() };
    scenario(&mut fs, &run.join("recovery"), &run.join("chapter1.md"), seed, REAL_STEPS, &mut tr);
    std::process::exit(0);
}

fn cmd_real(root: &Path, seeds: &[u64]) {
    let exe = std::env::current_exe().unwrap();
    let mut failures = Vec::new();
    let mut classes: BTreeMap<String, u64> = BTreeMap::new();
    let mut runs = 0;
    let started = Instant::now();
    for &seed in seeds {
        let init = real_init(seed);
        let sim_doc = Path::new("/novel/chapter1.md");
        let sim_dir = Path::new("/appdata/recovery");
        let ops = {
            let mut fs = sim_setup(&init, sim_doc);
            let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
            scenario(&mut fs, sim_dir, sim_doc, seed, REAL_STEPS, &mut tr);
            fs.ops
        };
        for n in 1..=ops {
            runs += 1;
            let run = root.join(format!("s{seed}-op{n:04}"));
            let _ = std::fs::remove_dir_all(&run);
            std::fs::create_dir_all(&run).unwrap();
            let doc = run.join("chapter1.md");
            std::fs::write(&doc, &init).unwrap();
            let id_before = fs::real_file_id(&doc).unwrap();
            let status = std::process::Command::new(&exe)
                .args(["real-child", run.to_str().unwrap(), &n.to_string(), &seed.to_string()])
                .status()
                .unwrap();
            if status.success() {
                failures.push(format!("seed {seed} op {n}: child did not crash"));
                continue;
            }
            // What the same run looks like on the simulated disk (same op order).
            let mut sim = sim_setup(&init, sim_doc);
            sim.crash_at = Some(n);
            sim.partial = true;
            let mut tr = Trace { hist: vec![init.clone()], ..Default::default() };
            scenario(&mut sim, sim_dir, sim_doc, seed, REAL_STEPS, &mut tr);

            let mut real = RealFs::default();
            let before = std::fs::read(&doc).unwrap();
            let label = format!("seed {seed} op {n}");
            match recover(&mut real, &run.join("recovery"), &doc) {
                Ok(None) => {
                    if tr.logged_gen != 0 {
                        failures.push(format!("{label}: no journal but gen {} was logged", tr.logged_gen));
                    }
                    *classes.entry("NoJournal".into()).or_default() += 1;
                }
                Ok(Some(r)) => {
                    if r.gen < tr.logged_gen || r.content != tr.hist[r.gen as usize] {
                        failures.push(format!("{label}: recovered gen {} (logged {})", r.gen, tr.logged_gen));
                    }
                    if matches!(r.class, DiskClass::Unknown | DiskClass::IdMismatch | DiskClass::Missing) {
                        failures.push(format!("{label}: classified {:?}", r.class));
                    }
                    *classes.entry(format!("{:?}", r.class)).or_default() += 1;
                }
                Err(e) => failures.push(format!("{label}: recover error {e:?}")),
            }
            if std::fs::read(&doc).unwrap() != before {
                failures.push(format!("{label}: recovery wrote to the manuscript"));
            }
            if fs::real_file_id(&doc).unwrap() != id_before {
                failures.push(format!("{label}: manuscript identity changed"));
            }
            let _ = std::fs::remove_dir_all(&run);
        }
    }
    println!("real: {runs} child processes aborted at every op ({:.1}s)", started.elapsed().as_secs_f64());
    println!("  disk state found at recovery: {classes:?}");
    println!("  manuscript file identity unchanged in every run");
    report(&failures);
}

// -------------------------------------------------------------------- bench

fn percentile(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() - 1) as f64 * p).round() as usize]
}

struct BenchRow {
    scheme: &'static str,
    size_kb: usize,
    save_ms: Vec<f64>,
    bytes_per_save: f64,
    syncs_per_save: f64,
    edit_us: Vec<f64>,
}

fn print_rows(rows: &mut [BenchRow]) {
    println!("| scheme | text | save median ms | save p95 ms | save max ms | written per save | fsync per save | per-edit record median us |");
    println!("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for r in rows.iter_mut() {
        let edit = if r.edit_us.is_empty() { "-".to_string() } else { format!("{:.0}", percentile(&mut r.edit_us, 0.5)) };
        let med = percentile(&mut r.save_ms, 0.5);
        let p95 = percentile(&mut r.save_ms, 0.95);
        let max = percentile(&mut r.save_ms, 1.0);
        println!(
            "| {} | {} KB | {:.2} | {:.2} | {:.2} | {:.0} KB | {:.2} | {} |",
            r.scheme, r.size_kb, med, p95, max, r.bytes_per_save / 1024.0, r.syncs_per_save, edit
        );
    }
}

fn cmd_bench(root: &Path) {
    // Autosave runs after 700 ms without input; the bench waits the same before each save.
    let saves = 20;
    let idle = std::time::Duration::from_millis(700);
    let edits_per_save = 20;
    let mut rows = Vec::new();
    for size_kb in [100usize, 1000, 3000] {
        let mut rng = Rng::new(size_kb as u64);
        let init = random_text(&mut rng, size_kb * 1024 / 3);
        let mut edits: Vec<Vec<(usize, usize, Vec<u8>)>> = Vec::new();
        {
            let mut content = init.clone();
            for _ in 0..saves {
                let mut batch = Vec::new();
                for _ in 0..edits_per_save {
                    let e = random_edit(&content, &mut rng);
                    content.splice(e.0..e.0 + e.1, e.2.iter().copied());
                    batch.push(e);
                }
                edits.push(batch);
            }
        }

        // Current Then: fs::write, then read back and hash.
        {
            let doc = root.join(format!("current-{size_kb}.md"));
            std::fs::write(&doc, &init).unwrap();
            let mut content = init.clone();
            let mut times = Vec::new();
            let mut written = 0u64;
            for batch in &edits {
                for e in batch {
                    content.splice(e.0..e.0 + e.1, e.2.iter().copied());
                }
                std::thread::sleep(idle);
                let t = Instant::now();
                std::fs::write(&doc, &content).unwrap();
                let back = std::fs::read(&doc).unwrap();
                let _ = sha(&back);
                times.push(t.elapsed().as_secs_f64() * 1e3);
                written += content.len() as u64;
            }
            rows.push(BenchRow { scheme: "current", size_kb, save_ms: times, bytes_per_save: written as f64 / saves as f64, syncs_per_save: 0.0, edit_us: vec![] });
        }

        // Expert scheme: verify, full backup + fsync, in place + fsync, read back.
        {
            let doc = root.join(format!("expert-{size_kb}.md"));
            let backup = root.join(format!("expert-{size_kb}.backup"));
            let log = root.join(format!("expert-{size_kb}.log"));
            std::fs::write(&doc, &init).unwrap();
            let _ = std::fs::remove_file(&log);
            let mut fs = RealFs::default();
            let mut content = init.clone();
            let mut times = Vec::new();
            let mut edit_us = Vec::new();
            let mut disk_hash = sha(&init);
            for batch in &edits {
                for e in batch {
                    let t = Instant::now();
                    content.splice(e.0..e.0 + e.1, e.2.iter().copied());
                    let mut rec = e.2.clone();
                    rec.extend_from_slice(&sha(&content));
                    fs.append(&log, &rec).unwrap();
                    edit_us.push(t.elapsed().as_secs_f64() * 1e6);
                }
                fs.sync(&log).unwrap();
                let stats_before = fs.stats.clone();
                std::thread::sleep(idle);
                let t = Instant::now();
                let cur = fs.read(&doc).unwrap();
                assert_eq!(sha(&cur), disk_hash);
                fs.create_write(&backup, &cur).unwrap();
                fs.sync(&backup).unwrap();
                if content.len() > cur.len() {
                    fs.set_len(&doc, content.len() as u64).unwrap();
                }
                fs.write_at(&doc, 0, &content).unwrap();
                if content.len() < cur.len() {
                    fs.set_len(&doc, content.len() as u64).unwrap();
                }
                fs.sync(&doc).unwrap();
                let back = fs.read(&doc).unwrap();
                disk_hash = sha(&back);
                times.push(t.elapsed().as_secs_f64() * 1e3);
                fs.close(&doc);
                let _ = stats_before;
            }
            // Count only the save path, not the per-edit log.
            let per_save_written = (2 * content.len()) as f64;
            rows.push(BenchRow { scheme: "expert", size_kb, save_ms: times, bytes_per_save: per_save_written, syncs_per_save: 2.0, edit_us });
        }

        // This scheme.
        {
            let run = root.join(format!("journal-{size_kb}"));
            let _ = std::fs::remove_dir_all(&run);
            std::fs::create_dir_all(&run).unwrap();
            let doc = run.join("chapter1.md");
            std::fs::write(&doc, &init).unwrap();
            let mut fs = RealFs::default();
            let mut j = Journal::start(&mut fs, &run.join("recovery"), &doc).unwrap();
            let mut times = Vec::new();
            let mut edit_us = Vec::new();
            let mut written = 0u64;
            let mut syncs = 0u64;
            for batch in &edits {
                for e in batch {
                    let t = Instant::now();
                    j.edit(&mut fs, e.0, e.1, &e.2).unwrap();
                    edit_us.push(t.elapsed().as_secs_f64() * 1e6);
                }
                // The background flusher has normally caught up before the
                // 700 ms idle save; do it here so the save measures only itself.
                j.flush(&mut fs).unwrap();
                let before = fs.stats.clone();
                std::thread::sleep(idle);
                let t = Instant::now();
                j.save(&mut fs).unwrap();
                times.push(t.elapsed().as_secs_f64() * 1e3);
                written += fs.stats.bytes_written - before.bytes_written;
                syncs += fs.stats.syncs - before.syncs;
            }
            assert_eq!(std::fs::read(&doc).unwrap(), j.content);
            println!("journal {size_kb} KB: {} compactions in {saves} saves", j.stats.compactions);
            let p = j.stats.phase_ms.map(|v| v / saves as f64);
            println!("  mean ms per save: verify {:.2}, intent+sync {:.2}, write {:.2}, read back {:.2}, done+compaction {:.2}", p[0], p[1], p[2], p[3], p[4]);
            rows.push(BenchRow { scheme: "journal", size_kb, save_ms: times, bytes_per_save: written as f64 / saves as f64, syncs_per_save: syncs as f64 / saves as f64, edit_us });
        }
    }
    print_rows(&mut rows);

    let big = random_text(&mut Rng::new(9), 1024 * 1024);
    let t = Instant::now();
    for _ in 0..20 {
        std::hint::black_box(sha(&big));
    }
    let secs = t.elapsed().as_secs_f64() / 20.0;
    println!("sha256: {:.0} MB/s ({:.2} ms per 3 MB text)", big.len() as f64 / secs / 1e6, 3.0 * 1024.0 * 1024.0 / (big.len() as f64 / secs) * 1e3);
}

/// Where the time of one save goes on this machine.
fn cmd_probe(root: &Path) {
    use std::io::Write;
    let small = vec![b'x'; 100];
    let big = random_text(&mut Rng::new(3), 1024 * 1024);
    let reps = 30;
    let time = |f: &mut dyn FnMut()| {
        let mut v: Vec<f64> = (0..reps)
            .map(|_| {
                let t = Instant::now();
                f();
                t.elapsed().as_secs_f64() * 1e3
            })
            .collect();
        percentile(&mut v, 0.5)
    };
    let p = root.join("probe.bin");
    std::fs::write(&p, &big).unwrap();
    let open_close = time(&mut || {
        drop(std::fs::OpenOptions::new().write(true).open(&p).unwrap());
    });
    let append_small_new_handle = time(&mut || {
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(&small).unwrap();
    });
    let mut held = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
    let append_small_held = time(&mut || held.write_all(&small).unwrap());
    let fsync_small = time(&mut || {
        held.write_all(&small).unwrap();
        held.sync_all().unwrap();
    });
    let write_3mb = time(&mut || std::fs::write(&p, &big).unwrap());
    let write_3mb_fsync = time(&mut || {
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(&big).unwrap();
        f.sync_all().unwrap();
    });
    let read_3mb = time(&mut || drop(std::fs::read(&p).unwrap()));
    let hash_3mb = time(&mut || drop(sha(&big)));
    println!("median of {reps}, 3 MB text (Japanese, UTF-8):");
    println!("  open + close a file                {open_close:.2} ms");
    println!("  append 100 B, new handle each time  {append_small_new_handle:.2} ms");
    println!("  append 100 B, handle kept open      {append_small_held:.3} ms");
    println!("  append 100 B + fsync               {fsync_small:.2} ms");
    println!("  write 3 MB (no fsync)              {write_3mb:.2} ms");
    println!("  write 3 MB + fsync                 {write_3mb_fsync:.2} ms");
    println!("  read 3 MB                          {read_3mb:.2} ms");
    println!("  sha256 of 3 MB                     {hash_3mb:.2} ms");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str);
    match arg(1) {
        Some("sim") => cmd_sim(arg(2).and_then(|v| v.parse().ok()).unwrap_or(40), 120),
        Some("external") => cmd_external(),
        Some("diskfull") => cmd_diskfull(arg(2).and_then(|v| v.parse().ok()).unwrap_or(20), 120),
        Some("real") => {
            let root = PathBuf::from(arg(2).expect("dir"));
            cmd_real(&root, &[11, 12]);
        }
        Some("real-child") => cmd_real_child(
            Path::new(arg(2).unwrap()),
            arg(3).unwrap().parse().unwrap(),
            arg(4).unwrap().parse().unwrap(),
        ),
        Some("bench") => cmd_bench(Path::new(arg(2).expect("dir"))),
        Some("probe") => cmd_probe(Path::new(arg(2).expect("dir"))),
        _ => eprintln!("usage: lab sim|external|diskfull|real <dir>|bench <dir>"),
    }
}
