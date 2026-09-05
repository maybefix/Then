"""Local-only JSON protocol. Offsets are UTF-16, matching the editor.

Morphology uses SudachiPy directly; dependency uses GiNZA's Sudachi tokenizer
and standard spaCy model. No text is sent to a service.
"""
import json
import sys


def analyze(text, mode):
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + (2 if ord(char) > 0xFFFF else 1))
    if offsets[-1] > 12000:
        raise ValueError("一度に解析できる本文は12,000文字（UTF-16）までです。")
    if mode not in ("morphology", "dependency"):
        raise ValueError("Unknown analysis mode")
    tokens = []
    if mode == "morphology":
        from sudachipy import dictionary, tokenizer
        tok = dictionary.Dictionary().create()
        base = 0
        sentence = 0
        for line in text.splitlines(keepends=True):
            for m in tok.tokenize(line, tokenizer.Tokenizer.SplitMode.C):
                surface = m.surface()
                # Normalizing an ellipsis to multiple periods can yield empty
                # morphemes at the same original offset. They have no text span
                # and morphology has no dependency indices to remap.
                if not surface and m.begin() == m.end():
                    continue
                tokens.append(dict(start=offsets[base + m.begin()], end=offsets[base + m.end()],
                    surface=surface, lemma=m.dictionary_form(), pos=m.part_of_speech()[0],
                    head=-1, dep="", sentence=sentence))
                if surface in ("。", "！", "？", "!", "?"):
                    sentence += 1
            base += len(line)
            sentence += 1
    else:
        import spacy
        import ginza
        nlp = spacy.load("ja_ginza")
        ginza.set_split_mode(nlp, "C")
        # Never link separate paragraphs. Token heads use global indices.
        base = 0
        sentence = 0
        for line in text.splitlines(keepends=True):
            doc = nlp(line)
            token_base = len(tokens)
            for sent in doc.sents:
                for t in sent:
                    tokens.append(dict(start=offsets[base + t.idx], end=offsets[base + t.idx + len(t.text)],
                        surface=t.text, lemma=t.lemma_, pos=t.pos_, head=token_base + t.head.i,
                        dep=t.dep_, sentence=sentence))
                sentence += 1
            base += len(line)
    result = dict(mode=mode, tokens=tokens)
    if mode == "dependency":
        # Preserve deterministic lexical checks even when the parser mistags a word.
        result["morphology"] = analyze(text, "morphology")["tokens"]
    return result


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    request = json.load(sys.stdin)
    print(json.dumps(analyze(request["text"], request["mode"]), ensure_ascii=False))
