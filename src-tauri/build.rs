use std::env;
use std::path::PathBuf;
use std::process::Command;

const LIBRAW_SOURCES: &[&str] = &[
    "src/decoders/canon_600.cpp",
    "src/decoders/crx.cpp",
    "src/decoders/decoders_dcraw.cpp",
    "src/decoders/decoders_libraw_dcrdefs.cpp",
    "src/decoders/decoders_libraw.cpp",
    "src/decoders/dng.cpp",
    "src/decoders/fp_dng.cpp",
    "src/decoders/fuji_compressed.cpp",
    "src/decoders/generic.cpp",
    "src/decoders/kodak_decoders.cpp",
    "src/decoders/load_mfbacks.cpp",
    "src/decoders/smal.cpp",
    "src/decoders/unpack_thumb.cpp",
    "src/decoders/unpack.cpp",
    "src/demosaic/aahd_demosaic.cpp",
    "src/demosaic/ahd_demosaic.cpp",
    "src/demosaic/dcb_demosaic.cpp",
    "src/demosaic/dht_demosaic.cpp",
    "src/demosaic/misc_demosaic.cpp",
    "src/demosaic/xtrans_demosaic.cpp",
    "src/integration/dngsdk_glue.cpp",
    "src/integration/rawspeed_glue.cpp",
    "src/libraw_c_api.cpp",
    "src/libraw_datastream.cpp",
    "src/metadata/adobepano.cpp",
    "src/metadata/canon.cpp",
    "src/metadata/ciff.cpp",
    "src/metadata/cr3_parser.cpp",
    "src/metadata/epson.cpp",
    "src/metadata/exif_gps.cpp",
    "src/metadata/fuji.cpp",
    "src/metadata/hasselblad_model.cpp",
    "src/metadata/identify_tools.cpp",
    "src/metadata/identify.cpp",
    "src/metadata/kodak.cpp",
    "src/metadata/leica.cpp",
    "src/metadata/makernotes.cpp",
    "src/metadata/mediumformat.cpp",
    "src/metadata/minolta.cpp",
    "src/metadata/misc_parsers.cpp",
    "src/metadata/nikon.cpp",
    "src/metadata/normalize_model.cpp",
    "src/metadata/olympus.cpp",
    "src/metadata/p1.cpp",
    "src/metadata/pentax.cpp",
    "src/metadata/samsung.cpp",
    "src/metadata/sony.cpp",
    "src/metadata/tiff.cpp",
    "src/postprocessing/aspect_ratio.cpp",
    "src/postprocessing/dcraw_process.cpp",
    "src/postprocessing/mem_image.cpp",
    "src/postprocessing/postprocessing_aux.cpp",
    "src/postprocessing/postprocessing_utils_dcrdefs.cpp",
    "src/postprocessing/postprocessing_utils.cpp",
    "src/preprocessing/ext_preprocess.cpp",
    "src/preprocessing/raw2image.cpp",
    "src/preprocessing/subtract_black.cpp",
    "src/tables/cameralist.cpp",
    "src/tables/colorconst.cpp",
    "src/tables/colordata.cpp",
    "src/tables/wblists.cpp",
    "src/utils/curves.cpp",
    "src/utils/decoder_info.cpp",
    "src/utils/init_close_utils.cpp",
    "src/utils/open.cpp",
    "src/utils/phaseone_processing.cpp",
    "src/utils/read_utils.cpp",
    "src/utils/thumb_utils.cpp",
    "src/utils/utils_dcraw.cpp",
    "src/utils/utils_libraw.cpp",
    "src/write/apply_profile.cpp",
    "src/write/file_write.cpp",
    "src/write/tiff_writer.cpp",
    "src/x3f/x3f_parse_process.cpp",
    "src/x3f/x3f_utils_patched.cpp",
];

fn libomp_prefix() -> Option<PathBuf> {
    println!("cargo:rerun-if-env-changed=LIBOMP_PREFIX");
    if let Some(explicit) = env::var_os("LIBOMP_PREFIX") {
        let path = PathBuf::from(explicit);
        if path.join("include").join("omp.h").is_file() {
            return Some(path);
        }
    }
    if let Ok(output) = Command::new("brew").args(["--prefix", "libomp"]).output() {
        if output.status.success() {
            let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            if path.join("include").join("omp.h").is_file() {
                return Some(path);
            }
        }
    }
    ["/opt/homebrew/opt/libomp", "/usr/local/opt/libomp"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.join("include").join("omp.h").is_file())
}

fn enable_openmp(build: &mut cc::Build) {
    let Some(prefix) = libomp_prefix() else {
        println!("cargo:warning=libomp not found (set LIBOMP_PREFIX or run `brew install libomp`); building LibRaw WITHOUT OpenMP - X-Trans/demosaic stays single-threaded");
        return;
    };
    let lib = prefix.join("lib");
    build
        .flag("-Xpreprocessor")
        .flag("-fopenmp")
        .include(prefix.join("include"))
        .define("LIBRAW_FORCE_OPENMP", None);
    println!("cargo:rustc-cfg=openmp");
    println!("cargo:rustc-link-search=native={}", lib.display());
    if lib.join("libomp.a").is_file() {
        println!("cargo:rustc-link-lib=static=omp");
        println!("cargo:warning=LibRaw OpenMP enabled (static libomp.a from {})", prefix.display());
    } else {
        // SPEC-GAP: static libomp.a absent at {prefix}/lib so linking dynamic libomp.dylib; the .app is then NOT self-contained - libomp.dylib must ship in the bundle (tauri.conf.json bundle.resources) and the load path fixed (install_name_tool -change {abs dylib} @rpath/libomp.dylib on the binary + a @loader_path rpath), else launch fails on machines without Homebrew libomp.
        println!("cargo:rustc-link-lib=dylib=omp");
        println!("cargo:warning=LibRaw OpenMP enabled with DYNAMIC libomp.dylib (no static archive found) - it MUST be bundled in the .app; see build.rs SPEC-GAP");
    }
}

fn main() {
    tauri_build::build();
    println!("cargo:rustc-check-cfg=cfg(openmp)");

    if env::var_os("CARGO_FEATURE_LIBRAW").is_none() {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"));
    let vendor = manifest_dir.join("vendor").join("libraw");

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++14")
        .warnings(false)
        .flag_if_supported("-w")
        .include(&vendor)
        .define("USE_ZLIB", "1")
        .define("USE_X3FTOOLS", "1");

    enable_openmp(&mut build);

    for source in LIBRAW_SOURCES {
        build.file(vendor.join(source));
    }

    build.compile("raw_viewer_libraw");

    println!("cargo:rustc-link-lib=z");
    println!("cargo:rerun-if-changed=vendor/libraw");

    let header = vendor.join("libraw").join("libraw.h");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));

    let bindings = bindgen::Builder::default()
        .header(header.to_string_lossy())
        .clang_arg("-x")
        .clang_arg("c")
        .clang_arg(format!("-I{}", vendor.display()))
        .allowlist_function("(?i)libraw_.*")
        .allowlist_type("(?i)libraw_.*")
        .allowlist_var("(?i)libraw_.*")
        .derive_debug(true)
        .derive_default(true)
        .layout_tests(false)
        .generate()
        .expect("bindgen failed to generate LibRaw bindings");

    bindings
        .write_to_file(out_dir.join("libraw_bindings.rs"))
        .expect("failed to write libraw_bindings.rs");
}
