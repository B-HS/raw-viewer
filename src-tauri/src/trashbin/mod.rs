use std::path::{Path, PathBuf};

use crate::pipeline::store::PixelStore;
use crate::scan::Registry;
use crate::xmp;

pub fn companion_paths(image_path: &Path) -> Vec<PathBuf> {
    let mut paths = vec![image_path.to_owned()];
    let sidecar = xmp::sidecar_path(image_path);
    if sidecar != image_path && sidecar.exists() {
        paths.push(sidecar);
    }
    paths
}

pub fn move_to_trash(registry: &Registry, store: &PixelStore, image_ids: &[String]) -> Vec<String> {
    let mut succeeded = Vec::new();
    for id in image_ids {
        let Some(path) = registry.resolve(id) else {
            continue;
        };
        let targets = companion_paths(&path);
        match trash::delete_all(&targets) {
            Ok(()) => {
                registry.remove(id);
                store.remove(id);
                succeeded.push(id.clone());
            }
            Err(error) => tracing::warn!(%error, image_id = %id, "move_to_trash failed"),
        }
    }
    succeeded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("raw-viewer-trash-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::create_dir_all(&base);
        base
    }

    #[test]
    fn companion_paths_includes_sidecar_when_present() {
        let dir = temp_dir("companion");
        let image = dir.join("IMG_1.CR2");
        let _ = std::fs::write(&image, b"raw");
        assert_eq!(companion_paths(&image), vec![image.clone()]);

        let sidecar = dir.join("IMG_1.xmp");
        let _ = std::fs::write(&sidecar, b"<xmp/>");
        assert_eq!(companion_paths(&image), vec![image.clone(), sidecar]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
