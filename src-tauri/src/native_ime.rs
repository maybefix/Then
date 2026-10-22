//! Opt-in experiment: a paragraph-sized native TSF client for the existing PM view.
//! COM objects and HWNDs live exclusively on the webview's UI thread.
use serde::Deserialize;

pub fn notify_layout(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let label = window.label().to_owned();
        let _ = window.with_webview(move |_| unsafe {
            imp::notify_layout(&label);
        });
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session: String,
    pub epoch: u32,
    pub acknowledged: u32,
    pub text: String,
    pub anchor: i32,
    pub head: i32,
    pub vertical: bool,
    pub dpr: f64,
    pub rects: Vec<[f64; 4]>,
    pub caret: [f64; 4],
    pub focus: bool,
}

#[tauri::command]
pub async fn native_ime_sync(
    window: tauri::WebviewWindow,
    snapshot: Snapshot,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window
            .with_webview(move |platform| {
                let result = unsafe { imp::sync(target, platform.controller(), snapshot) };
                let _ = tx.send(result.map_err(|e| format!("Native TSF: {e}")));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, snapshot);
        Err("Windows専用の入力試験です".into())
    }
}

#[tauri::command]
pub async fn native_ime_release(
    window: tauri::WebviewWindow,
    session: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let label = window.label().to_owned();
        window
            .with_webview(move |platform| unsafe {
                imp::release(&label, &session, platform.controller());
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, session);
    }
    Ok(())
}

#[tauri::command]
pub async fn native_ime_control(
    window: tauri::WebviewWindow,
    session: String,
    action: String,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        let label = window.label().to_owned();
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .with_webview(move |_| {
                let _ = tx.send(
                    unsafe { imp::control(&label, &session, &action) }.map_err(|e| e.to_string()),
                );
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, session, action);
        Err("Windows専用の入力試験です".into())
    }
}

#[cfg(windows)]
mod imp {
    #![allow(non_snake_case)]
    use super::Snapshot;
    use serde_json::json;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
        rc::Rc,
    };
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::{
        core::*,
        Win32::{
            Foundation::*,
            Graphics::Gdi::*,
            System::{Com::*, LibraryLoader::GetModuleHandleW, Variant::VARIANT},
            UI::{Input::KeyboardAndMouse::*, TextServices::*, WindowsAndMessaging::*},
        },
    };

    thread_local! { static BRIDGES: RefCell<HashMap<String, Bridge>> = RefCell::new(HashMap::new()); }

    struct Shared {
        emit: Box<dyn Fn(serde_json::Value)>,
        hwnd: Cell<HWND>,
        parent: HWND,
        snapshot: RefCell<Snapshot>,
        rectangles: RefCell<Vec<RECT>>,
        caret: Cell<RECT>,
        geometry_head: Cell<i32>,
        vertical: Cell<bool>,
        serial: Cell<u32>,
        syncing: Cell<bool>,
        composing: Cell<bool>,
        consumed_key: Cell<bool>,
        attribute_queries: Cell<u32>,
        geometry_queries: Cell<u32>,
        keys_seen: Cell<u32>,
        keys_consumed: Cell<u32>,
        published: RefCell<(String, i32, i32, bool)>,
    }
    impl Shared {
        fn event(&self, kind: &str, value: serde_json::Value) {
            let s = self.snapshot.borrow();
            (self.emit)(
                json!({"session":s.session,"epoch":s.epoch,"serial":self.serial.get(),"kind":kind,"value":value,"keysSeen":self.keys_seen.get(),"keysConsumed":self.keys_consumed.get(),"geometryQueries":self.geometry_queries.get(),"attributeQueries":self.attribute_queries.get()}),
            );
        }
    }

    #[implement(ITfContextOwner, ITfContextOwnerCompositionSink, ITfTextEditSink)]
    struct Owner {
        shared: Rc<Shared>,
    }
    impl ITfContextOwner_Impl for Owner_Impl {
        fn GetACPFromPoint(&self, point: *const POINT, _: u32) -> Result<i32> {
            if point.is_null() {
                return Err(Error::from(E_POINTER));
            }
            let mut point = unsafe { *point };
            let mut origin = POINT::default();
            if !unsafe { ClientToScreen(self.shared.parent, &mut origin) }.as_bool() {
                return Err(Error::from_win32());
            }
            point.x -= origin.x;
            point.y -= origin.y;
            let rects = self.shared.rectangles.borrow();
            let vertical = self.shared.vertical.get();
            let mut best = (i64::MAX, 0);
            for (i, r) in rects.iter().enumerate() {
                let dx = (point.x - r.left).min(0) as i64 + (point.x - r.right).max(0) as i64;
                let dy = (point.y - r.top).min(0) as i64 + (point.y - r.bottom).max(0) as i64;
                let distance = dx * dx + dy * dy;
                if distance < best.0 {
                    best = (
                        distance,
                        i + usize::from(if vertical {
                            point.y > (r.top + r.bottom) / 2
                        } else {
                            point.x > (r.left + r.right) / 2
                        }),
                    );
                }
            }
            Ok(best.1 as i32)
        }
        fn GetTextExt(
            &self,
            start: i32,
            end: i32,
            out: *mut RECT,
            clipped: *mut BOOL,
        ) -> Result<()> {
            self.shared
                .geometry_queries
                .set(self.shared.geometry_queries.get() + 1);
            if out.is_null() || clipped.is_null() {
                return Err(Error::from(E_POINTER));
            }
            if start < 0 || end < start {
                return Err(Error::from(TS_E_INVALIDPOS));
            }
            // An IME can change its text before the renderer supplies new bounds.
            // Use the latest actual caret for that short interval, never invented offsets.
            let rects = self.shared.rectangles.borrow();
            let mut r = self.shared.caret.get();
            if start == end
                && start != self.shared.geometry_head.get()
                && (start as usize) <= rects.len()
            {
                if let Some(glyph) = rects.get(start as usize) {
                    r = if self.shared.vertical.get() {
                        RECT {
                            bottom: glyph.top,
                            ..*glyph
                        }
                    } else {
                        RECT {
                            right: glyph.left,
                            ..*glyph
                        }
                    };
                } else if let Some(glyph) = rects.last() {
                    r = if self.shared.vertical.get() {
                        RECT {
                            top: glyph.bottom,
                            ..*glyph
                        }
                    } else {
                        RECT {
                            left: glyph.right,
                            ..*glyph
                        }
                    };
                }
            }
            if start != end && (end as usize) <= rects.len() {
                r = rects[start as usize];
                for next in &rects[start as usize..end as usize] {
                    r.left = r.left.min(next.left);
                    r.top = r.top.min(next.top);
                    r.right = r.right.max(next.right);
                    r.bottom = r.bottom.max(next.bottom);
                }
            }
            let mut origin = POINT::default();
            if !unsafe { ClientToScreen(self.shared.parent, &mut origin) }.as_bool() {
                return Err(Error::from_win32());
            }
            r.left += origin.x;
            r.right += origin.x;
            r.top += origin.y;
            r.bottom += origin.y;
            unsafe {
                out.write(r);
                clipped.write(false.into());
            }
            Ok(())
        }
        fn GetScreenExt(&self) -> Result<RECT> {
            unsafe {
                let mut r = RECT::default();
                GetClientRect(self.shared.parent, &mut r)?;
                let mut p = POINT::default();
                if !ClientToScreen(self.shared.parent, &mut p).as_bool() {
                    return Err(Error::from_win32());
                }
                Ok(RECT {
                    left: p.x,
                    top: p.y,
                    right: p.x + r.right,
                    bottom: p.y + r.bottom,
                })
            }
        }
        fn GetStatus(&self) -> Result<TS_STATUS> {
            Ok(TS_STATUS::default())
        }
        fn GetWnd(&self) -> Result<HWND> {
            Ok(self.shared.hwnd.get())
        }
        fn GetAttribute(&self, guid: *const GUID) -> Result<VARIANT> {
            if guid.is_null() {
                return Err(Error::from(E_POINTER));
            }
            Ok(if unsafe { *guid } == TSATTRID_Text_VerticalWriting {
                self.shared
                    .attribute_queries
                    .set(self.shared.attribute_queries.get() + 1);
                VARIANT::from(self.shared.vertical.get())
            } else {
                VARIANT::default()
            })
        }
    }
    impl ITfContextOwnerCompositionSink_Impl for Owner_Impl {
        fn OnStartComposition(&self, _: Ref<'_, ITfCompositionView>) -> Result<BOOL> {
            self.shared.composing.set(true);
            Ok(true.into())
        }
        fn OnUpdateComposition(
            &self,
            _: Ref<'_, ITfCompositionView>,
            _: Ref<'_, ITfRange>,
        ) -> Result<()> {
            Ok(())
        }
        fn OnEndComposition(&self, _: Ref<'_, ITfCompositionView>) -> Result<()> {
            self.shared.composing.set(false);
            Ok(())
        }
    }
    unsafe fn text(range: &ITfRange, cookie: u32) -> Result<String> {
        let range = range.Clone()?;
        let mut all = Vec::new();
        loop {
            let mut buffer = [0u16; 4096];
            let mut count = 0;
            range.GetText(cookie, TF_TF_MOVESTART, &mut buffer, &mut count)?;
            all.extend_from_slice(&buffer[..count as usize]);
            if count < 4096 {
                break;
            }
        }
        Ok(String::from_utf16_lossy(&all))
    }
    unsafe fn extent(context: &ITfContext, range: &ITfRange, cookie: u32) -> Result<(i32, i32)> {
        let prefix = context.GetStart(cookie)?;
        prefix.ShiftEndToRange(cookie, range, TF_ANCHOR_START)?;
        Ok((
            text(&prefix, cookie)?.encode_utf16().count() as i32,
            text(range, cookie)?.encode_utf16().count() as i32,
        ))
    }
    impl ITfTextEditSink_Impl for Owner_Impl {
        fn OnEndEdit(
            &self,
            context: Ref<'_, ITfContext>,
            cookie: u32,
            _: Ref<'_, ITfEditRecord>,
        ) -> Result<()> {
            unsafe {
                if self.shared.syncing.get() {
                    return Ok(());
                }
                let context = context.ok()?;
                let range = context.GetStart(cookie)?;
                range.ShiftEndToRange(cookie, &context.GetEnd(cookie)?, TF_ANCHOR_END)?;
                let value = text(&range, cookie)?;
                let mut selections = [TF_SELECTION::default()];
                let mut fetched = 0;
                context.GetSelection(
                    cookie,
                    TF_DEFAULT_SELECTION,
                    &mut selections,
                    &mut fetched,
                )?;
                let (mut anchor, mut head) = (0, 0);
                if let Some(selected) = selections[0].range.as_ref() {
                    let (start, len) = extent(context, selected, cookie)?;
                    anchor = start;
                    head = start + len;
                    if selections[0].style.ase == TF_AE_START {
                        std::mem::swap(&mut anchor, &mut head);
                    }
                }
                std::mem::ManuallyDrop::drop(&mut selections[0].range);
                let mut composition = None;
                if self.shared.composing.get() {
                    let compositions: ITfContextComposition = context.cast()?;
                    let views = compositions.EnumCompositions()?;
                    let mut items = [None];
                    let mut count = 0;
                    views.Next(&mut items, &mut count)?;
                    if let Some(view) = items[0].as_ref() {
                        let (start, len) = extent(context, &view.GetRange()?, cookie)?;
                        composition = Some([start, start + len]);
                    }
                }
                let next = (value.clone(), anchor, head, self.shared.composing.get());
                if *self.shared.published.borrow() == next {
                    return Ok(());
                }
                *self.shared.published.borrow_mut() = next;
                self.shared
                    .serial
                    .set(self.shared.serial.get().wrapping_add(1));
                self.shared.event("edit",json!({"text":value,"anchor":anchor,"head":head,"composing":self.shared.composing.get(),"composition":composition}));
                Ok(())
            }
        }
    }

    #[implement(ITfEditSession)]
    struct ReplaceSession {
        context: ITfContext,
        text: String,
        anchor: i32,
        head: i32,
    }
    impl ITfEditSession_Impl for ReplaceSession_Impl {
        fn DoEditSession(&self, cookie: u32) -> Result<()> {
            unsafe {
                let range = self.context.GetStart(cookie)?;
                range.ShiftEndToRange(cookie, &self.context.GetEnd(cookie)?, TF_ANCHOR_END)?;
                if text(&range, cookie)? != self.text {
                    range.SetText(cookie, 0, &self.text.encode_utf16().collect::<Vec<_>>())?;
                }
                let selected = self.context.GetStart(cookie)?;
                let mut moved = 0;
                selected.ShiftEnd(
                    cookie,
                    self.anchor.max(self.head),
                    &mut moved,
                    std::ptr::null(),
                )?;
                selected.ShiftStart(
                    cookie,
                    self.anchor.min(self.head),
                    &mut moved,
                    std::ptr::null(),
                )?;
                let mut selection = TF_SELECTION {
                    range: std::mem::ManuallyDrop::new(Some(selected)),
                    style: TF_SELECTIONSTYLE {
                        ase: if self.head < self.anchor {
                            TF_AE_START
                        } else {
                            TF_AE_END
                        },
                        fInterimChar: false.into(),
                    },
                };
                let result = self
                    .context
                    .SetSelection(cookie, std::slice::from_ref(&selection));
                std::mem::ManuallyDrop::drop(&mut selection.range);
                result?;
                Ok(())
            }
        }
    }

    #[implement(ITfEditSession)]
    struct InsertSession {
        context: ITfContext,
        units: Vec<u16>,
    }
    impl ITfEditSession_Impl for InsertSession_Impl {
        fn DoEditSession(&self, cookie: u32) -> Result<()> {
            unsafe {
                let mut selection = [TF_SELECTION::default()];
                let mut fetched = 0;
                self.context.GetSelection(
                    cookie,
                    TF_DEFAULT_SELECTION,
                    &mut selection,
                    &mut fetched,
                )?;
                let range = selection[0].range.as_ref().cloned();
                std::mem::ManuallyDrop::drop(&mut selection[0].range);
                let range = range.ok_or_else(|| Error::from(E_FAIL))?;
                range.SetText(cookie, 0, &self.units)?;
                range.Collapse(cookie, TF_ANCHOR_END)?;
                let mut selection = TF_SELECTION {
                    range: std::mem::ManuallyDrop::new(Some(range)),
                    style: TF_SELECTIONSTYLE {
                        ase: TF_AE_END,
                        fInterimChar: false.into(),
                    },
                };
                let result = self
                    .context
                    .SetSelection(cookie, std::slice::from_ref(&selection));
                std::mem::ManuallyDrop::drop(&mut selection.range);
                result
            }
        }
    }
    struct Route {
        shared: Rc<Shared>,
        manager: ITfThreadMgr,
        document: ITfDocumentMgr,
        context: ITfContext,
        client: u32,
        high_surrogate: Cell<Option<u16>>,
    }
    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Route;
        if !ptr.is_null() {
            let route = &*ptr;
            match msg {
                WM_GETDLGCODE => {
                    return LRESULT((DLGC_WANTALLKEYS | DLGC_WANTCHARS | DLGC_WANTARROWS) as isize)
                }
                WM_SETFOCUS => {
                    let _ = route.manager.SetFocus(&route.document);
                    route.shared.event("focus", json!(true));
                }
                WM_KILLFOCUS => {
                    route.shared.event("focus", json!(false));
                }
                WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP => {
                    route.shared.keys_seen.set(route.shared.keys_seen.get() + 1);
                    let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                    if let Ok(keys) = route.manager.cast::<ITfKeystrokeMgr>() {
                        let consumed = if down {
                            keys.TestKeyDown(w, l).unwrap_or_default().as_bool()
                                && keys.KeyDown(w, l).unwrap_or_default().as_bool()
                        } else {
                            keys.TestKeyUp(w, l).unwrap_or_default().as_bool()
                                && keys.KeyUp(w, l).unwrap_or_default().as_bool()
                        };
                        if down {
                            route.shared.consumed_key.set(consumed);
                        }
                        if consumed {
                            route
                                .shared
                                .keys_consumed
                                .set(route.shared.keys_consumed.get() + 1);
                            return LRESULT(0);
                        }
                    }
                    route.shared.event("key",json!({"down":down,"vk":w.0,"shift":GetKeyState(VK_SHIFT.0 as i32)<0,"ctrl":GetKeyState(VK_CONTROL.0 as i32)<0,"alt":GetKeyState(VK_MENU.0 as i32)<0,"repeat":(l.0&(1<<30))!=0}));
                    return LRESULT(0);
                }
                WM_CHAR => {
                    if !route.shared.consumed_key.get() && w.0 >= 32 && w.0 != 127 {
                        let unit = w.0 as u16;
                        if (0xd800..=0xdbff).contains(&unit) {
                            route.high_surrogate.set(Some(unit));
                            return LRESULT(0);
                        }
                        let mut units = Vec::new();
                        if let Some(high) = route.high_surrogate.take() {
                            units.push(high);
                        }
                        units.push(unit);
                        let session: ITfEditSession = InsertSession {
                            context: route.context.clone(),
                            units,
                        }
                        .into();
                        if let Err(error) = route
                            .context
                            .RequestEditSession(
                                route.client,
                                &session,
                                TF_ES_SYNC | TF_ES_READWRITE,
                            )
                            .and_then(|r| r.ok())
                        {
                            route.shared.event("error", json!(error.to_string()));
                        }
                    }
                    return LRESULT(0);
                }
                _ => {}
            }
        }
        DefWindowProcW(hwnd, msg, w, l)
    }

    struct Bridge {
        shared: Rc<Shared>,
        manager: ITfThreadMgr,
        document: ITfDocumentMgr,
        context: ITfContext,
        client: u32,
        cookies: Vec<u32>,
        route: *mut Route,
    }
    impl Drop for Bridge {
        fn drop(&mut self) {
            unsafe {
                SetWindowLongPtrW(self.shared.hwnd.get(), GWLP_USERDATA, 0);
                if let Ok(source) = self.context.cast::<ITfSource>() {
                    for cookie in &self.cookies {
                        let _ = source.UnadviseSink(*cookie);
                    }
                }
                let _ = self.document.Pop(TF_POPF_ALL);
                let _ = self.manager.Deactivate();
                let _ = DestroyWindow(self.shared.hwnd.get());
                drop(Box::from_raw(self.route));
            }
        }
    }
    impl Bridge {
        unsafe fn new(
            emit: Box<dyn Fn(serde_json::Value)>,
            parent: HWND,
            snapshot: Snapshot,
        ) -> Result<Self> {
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(proc),
                hInstance: instance.into(),
                lpszClassName: w!("ThenParagraphTsfInput"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE,
                w!("ThenParagraphTsfInput"),
                w!("Then paragraph input"),
                WS_CHILD | WS_VISIBLE,
                -2,
                -2,
                1,
                1,
                Some(parent),
                None,
                Some(instance.into()),
                None,
            )?;
            let vertical = snapshot.vertical;
            let head = snapshot.head;
            let shared = Rc::new(Shared {
                emit,
                hwnd: Cell::new(hwnd),
                parent,
                snapshot: RefCell::new(snapshot),
                rectangles: RefCell::new(Vec::new()),
                caret: Cell::new(RECT::default()),
                geometry_head: Cell::new(head),
                vertical: Cell::new(vertical),
                serial: Cell::new(0),
                syncing: Cell::new(false),
                composing: Cell::new(false),
                consumed_key: Cell::new(false),
                attribute_queries: Cell::new(0),
                geometry_queries: Cell::new(0),
                keys_seen: Cell::new(0),
                keys_consumed: Cell::new(0),
                published: RefCell::new((String::new(), 0, 0, false)),
            });
            let manager: ITfThreadMgr =
                CoCreateInstance(&CLSID_TF_ThreadMgr, None, CLSCTX_INPROC_SERVER)?;
            let client = manager.Activate()?;
            let document = manager.CreateDocumentMgr()?;
            let owner: ITfContextOwner = Owner {
                shared: shared.clone(),
            }
            .into();
            let unknown: IUnknown = owner.cast()?;
            let mut context = None;
            let mut cookie = 0;
            document.CreateContext(client, 0, &unknown, &mut context, &mut cookie)?;
            let context = context.ok_or_else(|| Error::from(E_POINTER))?;
            let source: ITfSource = context.cast()?;
            let mut cookies = Vec::new();
            for iid in [&ITfContextOwner::IID, &ITfTextEditSink::IID] {
                cookies.push(source.AdviseSink(iid, &unknown)?);
            }
            document.Push(&context)?;
            let _ = manager.AssociateFocus(hwnd, &document);
            let route = Box::into_raw(Box::new(Route {
                shared: shared.clone(),
                manager: manager.clone(),
                document: document.clone(),
                context: context.clone(),
                client,
                high_surrogate: Cell::new(None),
            }));
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, route as isize);
            Ok(Self {
                shared,
                manager,
                document,
                context,
                client,
                cookies,
                route,
            })
        }
        unsafe fn update(&self, snapshot: Snapshot) -> Result<()> {
            let length = snapshot.text.encode_utf16().count() as i32;
            if snapshot.anchor < 0
                || snapshot.head < 0
                || snapshot.anchor > length
                || snapshot.head > length
                || !snapshot.dpr.is_finite()
                || snapshot.dpr <= 0.0
                || snapshot.rects.len() > 1_000_000
                || snapshot
                    .rects
                    .iter()
                    .chain(std::iter::once(&snapshot.caret))
                    .flatten()
                    .any(|n| !n.is_finite())
            {
                return Err(Error::from(E_INVALIDARG));
            }
            // Cache client coordinates; query the actual window origin at GetTextExt.
            let physical = |r: &[f64; 4]| RECT {
                left: (r[0] * snapshot.dpr).floor() as i32,
                top: (r[1] * snapshot.dpr).floor() as i32,
                right: ((r[0] + r[2]) * snapshot.dpr).ceil() as i32,
                bottom: ((r[1] + r[3]) * snapshot.dpr).ceil() as i32,
            };
            *self.shared.rectangles.borrow_mut() = snapshot.rects.iter().map(physical).collect();
            self.shared.caret.set(physical(&snapshot.caret));
            self.shared.geometry_head.set(snapshot.head);
            self.shared.vertical.set(snapshot.vertical);
            let focus = snapshot.focus;
            if !self.shared.composing.get() && snapshot.acknowledged == self.shared.serial.get() {
                let changed = {
                    let old = self.shared.snapshot.borrow();
                    old.text != snapshot.text
                        || old.anchor != snapshot.anchor
                        || old.head != snapshot.head
                        || old.epoch != snapshot.epoch
                        || self.shared.serial.get() == 0
                };
                let session: ITfEditSession = ReplaceSession {
                    context: self.context.clone(),
                    text: snapshot.text.clone(),
                    anchor: snapshot.anchor,
                    head: snapshot.head,
                }
                .into();
                *self.shared.published.borrow_mut() =
                    (snapshot.text.clone(), snapshot.anchor, snapshot.head, false);
                *self.shared.snapshot.borrow_mut() = snapshot;
                if changed {
                    self.shared.syncing.set(true);
                    let result = self
                        .context
                        .RequestEditSession(self.client, &session, TF_ES_SYNC | TF_ES_READWRITE)
                        .and_then(|r| r.ok());
                    self.shared.syncing.set(false);
                    result?;
                }
            }
            let services: ITfContextOwnerServices = self.context.cast()?;
            services.OnAttributeChange(&TSATTRID_Text_VerticalWriting)?;
            services.OnLayoutChange()?;
            if focus {
                let _ = SetFocus(Some(self.shared.hwnd.get()));
                if GetFocus() != self.shared.hwnd.get() {
                    return Err(Error::new(
                        E_FAIL,
                        "TSF入力ウィンドウへフォーカスを移せませんでした",
                    ));
                }
                self.manager.SetFocus(&self.document)?;
            }
            Ok(())
        }
    }
    pub unsafe fn sync(
        window: tauri::WebviewWindow,
        controller: ICoreWebView2Controller,
        snapshot: Snapshot,
    ) -> Result<serde_json::Value> {
        let mut parent = HWND::default();
        controller.ParentWindow(&mut parent)?;
        let label = window.label().to_owned();
        // Remove before entering COM: sinks may be called synchronously.
        let old = BRIDGES.with(|all| all.borrow_mut().remove(&label));
        let bridge = match old {
            Some(bridge) if bridge.shared.snapshot.borrow().session == snapshot.session => bridge,
            _ => Bridge::new(
                Box::new(move |value| {
                    let _ = window.emit("native-ime", value);
                }),
                parent,
                snapshot.clone(),
            )?,
        };
        let result = bridge.update(snapshot).map(|_| json!({"focused":GetFocus()==bridge.shared.hwnd.get(),"keysSeen":bridge.shared.keys_seen.get(),"keysConsumed":bridge.shared.keys_consumed.get(),"geometryQueries":bridge.shared.geometry_queries.get(),"attributeQueries":bridge.shared.attribute_queries.get(),"edits":bridge.shared.serial.get()}));
        BRIDGES.with(|all| all.borrow_mut().insert(label, bridge));
        result
    }
    pub unsafe fn release(label: &str, session: &str, controller: ICoreWebView2Controller) {
        let bridge = BRIDGES.with(|all| all.borrow_mut().remove(label));
        if let Some(bridge) = bridge {
            if bridge.shared.snapshot.borrow().session != session {
                BRIDGES.with(|all| all.borrow_mut().insert(label.to_owned(), bridge));
                return;
            }
            if let Ok(services) = bridge.context.cast::<ITfContextOwnerCompositionServices>() {
                let _ = services.TerminateComposition(None);
            }
            let focused = GetFocus() == bridge.shared.hwnd.get();
            drop(bridge);
            if focused {
                let _ = controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
        }
    }
    pub unsafe fn notify_layout(label: &str) {
        BRIDGES.with(|all| {
            if let Some(bridge) = all.borrow().get(label) {
                if let Ok(services) = bridge.context.cast::<ITfContextOwnerServices>() {
                    let _ = services.OnLayoutChange();
                }
            }
        });
    }
    pub unsafe fn control(label: &str, session: &str, action: &str) -> Result<serde_json::Value> {
        BRIDGES.with(|all|{
            let all=all.borrow();let bridge=all.get(label).ok_or_else(||Error::new(E_FAIL,"TSF入力を有効にしてください"))?;
            if bridge.shared.snapshot.borrow().session!=session{return Err(Error::from(E_INVALIDARG));}
            let compartments:ITfCompartmentMgr=bridge.manager.cast()?;
            let open=compartments.GetCompartment(&GUID_COMPARTMENT_KEYBOARD_OPENCLOSE)?;
            match action {
                "open"=>{
                    let _=SetFocus(Some(bridge.shared.hwnd.get()));bridge.manager.SetFocus(&bridge.document)?;
                    open.SetValue(bridge.client,&VARIANT::from(1i32))?;
                    compartments.GetCompartment(&GUID_COMPARTMENT_KEYBOARD_INPUTMODE_CONVERSION)?.SetValue(bridge.client,&VARIANT::from((TF_CONVERSIONMODE_NATIVE|TF_CONVERSIONMODE_FULLSHAPE) as i32))?;
                }
                "inspect"=>{},
                _=>return Err(Error::from(E_INVALIDARG)),
            }
            let mut profile=TF_INPUTPROCESSORPROFILE::default();
            let profiles:ITfInputProcessorProfileMgr=CoCreateInstance(&CLSID_TF_InputProcessorProfiles,None,CLSCTX_INPROC_SERVER)?;
            let profile_result=profiles.GetActiveProfile(&GUID_TFCAT_TIP_KEYBOARD,&mut profile);
            Ok(json!({"keysSeen":bridge.shared.keys_seen.get(),"keysConsumed":bridge.shared.keys_consumed.get(),"attributeQueries":bridge.shared.attribute_queries.get(),"geometryQueries":bridge.shared.geometry_queries.get(),"open":open.GetValue().ok().and_then(|v|i32::try_from(&v).ok()),"focused":GetFocus()==bridge.shared.hwnd.get(),"language":profile.langid,"profile":format!("{:?}",profile.guidProfile),"profileLoaded":profile_result.is_ok(),"composing":bridge.shared.composing.get(),"serial":bridge.shared.serial.get(),"characters":bridge.shared.snapshot.borrow().text.encode_utf16().count()}))
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[implement(ITfEditSession)]
        struct ReadSession {
            context: ITfContext,
            expected: String,
            vertical: bool,
            rectangle: RECT,
        }
        impl ITfEditSession_Impl for ReadSession_Impl {
            fn DoEditSession(&self, cookie: u32) -> Result<()> {
                unsafe {
                    let range = self.context.GetStart(cookie)?;
                    range.ShiftEndToRange(cookie, &self.context.GetEnd(cookie)?, TF_ANCHOR_END)?;
                    assert_eq!(text(&range, cookie)?, self.expected);
                    let value = self
                        .context
                        .GetAppProperty(&TSATTRID_Text_VerticalWriting)?
                        .GetValue(cookie, &range)?;
                    assert_eq!(bool::try_from(&value)?, self.vertical);
                    let mut rectangle = RECT::default();
                    let mut clipped = BOOL::default();
                    self.context.GetActiveView()?.GetTextExt(
                        cookie,
                        &range,
                        &mut rectangle,
                        &mut clipped,
                    )?;
                    assert_eq!(rectangle, self.rectangle);
                    assert!(!clipped.as_bool());
                    Ok(())
                }
            }
        }
        #[test]
        fn native_paragraph_edit_acknowledgement_and_geometry() {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
                let parent = CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!("Then TSF protocol unit test"),
                    WS_OVERLAPPEDWINDOW,
                    100,
                    100,
                    800,
                    600,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap();
                let events = Rc::new(RefCell::new(Vec::new()));
                let sink = events.clone();
                let snapshot = Snapshot {
                    session: "unit-test".into(),
                    epoch: 1,
                    acknowledged: 0,
                    text: "あいう".into(),
                    anchor: 1,
                    head: 2,
                    vertical: true,
                    dpr: 1.0,
                    rects: vec![
                        [100.0, 50.0, 24.0, 24.0],
                        [100.0, 74.0, 24.0, 24.0],
                        [100.0, 98.0, 24.0, 24.0],
                    ],
                    caret: [100.0, 98.0, 24.0, 0.0],
                    focus: false,
                };
                let bridge = Bridge::new(
                    Box::new(move |event| sink.borrow_mut().push(event)),
                    parent,
                    snapshot.clone(),
                )
                .unwrap();
                bridge.update(snapshot.clone()).unwrap();
                assert!(
                    events.borrow().iter().all(|e| e["kind"] != "edit"),
                    "Synchronizing PM state must not echo an edit back to PM: {:?}",
                    events.borrow()
                );
                // A native edit goes through the real TSF store and real OnEndEdit sink.
                // This is a protocol test, not a synthesized OS keyboard/IME test.
                let session: ITfEditSession = ReplaceSession {
                    context: bridge.context.clone(),
                    text: "あ日本う".into(),
                    anchor: 3,
                    head: 3,
                }
                .into();
                bridge
                    .context
                    .RequestEditSession(bridge.client, &session, TF_ES_SYNC | TF_ES_READWRITE)
                    .unwrap()
                    .ok()
                    .unwrap();
                let edit = events
                    .borrow()
                    .last()
                    .cloned()
                    .expect("native edit notification");
                assert_eq!(edit["kind"], "edit");
                assert_eq!(edit["value"]["text"], "あ日本う");
                assert_eq!(edit["value"]["head"], 3);
                assert_eq!(edit["serial"], 1);
                // A late renderer geometry message must never overwrite an unacknowledged edit.
                bridge.update(snapshot.clone()).unwrap();
                let last_event_count = events.borrow().len();
                let check = |vertical, mut expected: RECT| {
                    let mut origin = POINT::default();
                    assert!(ClientToScreen(parent, &mut origin).as_bool());
                    expected.left += origin.x;
                    expected.right += origin.x;
                    expected.top += origin.y;
                    expected.bottom += origin.y;
                    let read: ITfEditSession = ReadSession {
                        context: bridge.context.clone(),
                        expected: "あ日本う".into(),
                        vertical,
                        rectangle: expected,
                    }
                    .into();
                    bridge
                        .context
                        .RequestEditSession(bridge.client, &read, TF_ES_SYNC | TF_ES_READ)
                        .unwrap()
                        .ok()
                        .unwrap();
                };
                let mut current = snapshot.clone();
                current.text = "あ日本う".into();
                current.anchor = 3;
                current.head = 3;
                current.acknowledged = 1;
                current.rects.push([100.0, 122.0, 24.0, 24.0]);
                bridge.update(current.clone()).unwrap();
                let rects = bridge.shared.rectangles.borrow();
                let first = rects[0];
                let last = rects[3];
                drop(rects);
                check(
                    true,
                    RECT {
                        left: first.left,
                        top: first.top,
                        right: last.right,
                        bottom: last.bottom,
                    },
                );
                current.vertical = false;
                current.dpr = 1.25;
                bridge.update(current).unwrap();
                let rects = bridge.shared.rectangles.borrow();
                let first = rects[0];
                let last = rects[3];
                drop(rects);
                check(
                    false,
                    RECT {
                        left: first.left,
                        top: first.top,
                        right: last.right,
                        bottom: last.bottom,
                    },
                );
                assert_eq!(
                    events.borrow().len(),
                    last_event_count,
                    "acknowledgement and layout updates do not echo"
                );
                let insert: ITfEditSession = InsertSession {
                    context: bridge.context.clone(),
                    units: "😀".encode_utf16().collect(),
                }
                .into();
                bridge
                    .context
                    .RequestEditSession(bridge.client, &insert, TF_ES_SYNC | TF_ES_READWRITE)
                    .unwrap()
                    .ok()
                    .unwrap();
                let edit = events.borrow().last().cloned().unwrap();
                assert_eq!(edit["value"]["text"], "あ日本😀う");
                assert_eq!(edit["value"]["head"], 5);
                assert_eq!(edit["serial"], 2);
                drop(bridge);
                DestroyWindow(parent).unwrap();
                CoUninitialize();
            }
        }
    }
}
