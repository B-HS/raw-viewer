use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, NSObject, NSObjectProtocol, Sel};
use objc2::{define_class, ffi, msg_send, sel, AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::NSString;
use tauri::{AppHandle, Emitter, Manager};

use crate::platform::recents::RecentsService;
use crate::types_platform::OpenRequestPayload;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static CURRENT: Mutex<Option<PathBuf>> = Mutex::new(None);
static TARGET: AtomicPtr<AnyObject> = AtomicPtr::new(null_mut());

const RECENTS_MENU_LIMIT: usize = 10;

pub fn set_current(path: Option<PathBuf>) {
    let mut guard = CURRENT.lock().unwrap_or_else(PoisonError::into_inner);
    *guard = path;
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "RawViewerDockHandler"]
    struct DockHandler;

    unsafe impl NSObjectProtocol for DockHandler {}

    impl DockHandler {
        #[unsafe(method(dockOpen:))]
        fn dock_open(&self, sender: &NSMenuItem) {
            handle_dock_open(sender);
        }

        #[unsafe(method(dockClearRecents:))]
        fn dock_clear_recents(&self, _sender: &NSMenuItem) {
            handle_dock_clear();
        }
    }
);

impl DockHandler {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

#[allow(deprecated)]
fn handle_dock_open(sender: &NSMenuItem) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    let Some(represented) = sender.representedObject() else {
        return;
    };
    let Ok(string) = represented.downcast::<NSString>() else {
        return;
    };
    let path = PathBuf::from(string.to_string());
    if let Some(mtm) = MainThreadMarker::new() {
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit("dock:open", OpenRequestPayload { path }) {
        tracing::warn!(%error, "emit dock:open failed");
    }
}

fn handle_dock_clear() {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    if let Err(error) = app.state::<RecentsService>().clear() {
        tracing::warn!(%error, "dock clear recents failed");
    }
    let _ = app.emit("recents:changed", ());
}

extern "C-unwind" fn application_dock_menu(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return null_mut();
    };
    let Some(app) = APP_HANDLE.get() else {
        return null_mut();
    };
    let entries = app.state::<RecentsService>().list(RECENTS_MENU_LIMIT).unwrap_or_default();
    let current = CURRENT.lock().unwrap_or_else(PoisonError::into_inner).clone();
    let target = TARGET.load(Ordering::Acquire);

    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);

    let header = NSMenuItem::new(mtm);
    header.setTitle(&NSString::from_str("최근 항목"));
    header.setEnabled(false);
    menu.addItem(&header);

    for entry in &entries {
        let is_current = current.as_deref() == Some(entry.path.as_path());
        let prefix = if is_current { "● " } else { "\u{3000}" };
        let item = NSMenuItem::new(mtm);
        item.setTitle(&NSString::from_str(&format!("{prefix}{}", entry.filename)));
        let represented: &AnyObject = &NSString::from_str(&entry.path.to_string_lossy());
        unsafe {
            item.setRepresentedObject(Some(represented));
            if !target.is_null() {
                item.setTarget(Some(&*target));
                item.setAction(Some(sel!(dockOpen:)));
            }
        }
        item.setEnabled(true);
        menu.addItem(&item);
    }

    menu.addItem(&NSMenuItem::separatorItem(mtm));

    let clear = NSMenuItem::new(mtm);
    clear.setTitle(&NSString::from_str("최근 항목 지우기"));
    unsafe {
        if !target.is_null() {
            clear.setTarget(Some(&*target));
            clear.setAction(Some(sel!(dockClearRecents:)));
        }
    }
    clear.setEnabled(!entries.is_empty());
    menu.addItem(&clear);

    Retained::autorelease_return(menu)
}

pub fn install(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    let Some(mtm) = MainThreadMarker::new() else {
        tracing::warn!("dock install skipped: not on main thread");
        return;
    };
    if TARGET.load(Ordering::Acquire).is_null() {
        let raw = Retained::into_raw(DockHandler::new()) as *mut AnyObject;
        TARGET.store(raw, Ordering::Release);
    }
    let ns_app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = ns_app.delegate() else {
        // SPEC-GAP: Tauri application delegate not set at Ready; Dock menu not installed (recents + note_recent_document still active).
        tracing::warn!("dock menu skipped: no application delegate");
        return;
    };
    let class_ptr = unsafe { ffi::object_getClass(Retained::as_ptr(&delegate) as *const AnyObject) } as *mut AnyClass;
    if class_ptr.is_null() {
        tracing::warn!("dock menu skipped: delegate class is null");
        return;
    }
    let imp: Imp = unsafe {
        std::mem::transmute::<extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut NSMenu, Imp>(application_dock_menu)
    };
    let added = unsafe { ffi::class_addMethod(class_ptr, sel!(applicationDockMenu:), imp, c"@@:@".as_ptr()) };
    if added.as_bool() {
        tracing::info!("dock menu installed");
    } else {
        // SPEC-GAP: delegate already implements applicationDockMenu:; Tauri behavior left intact.
        tracing::warn!("dock menu injection skipped: applicationDockMenu: already present");
    }
}
