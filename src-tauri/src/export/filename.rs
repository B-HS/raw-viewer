use std::path::{Path, PathBuf};

use crate::types_export::{ConflictPolicy, RasterFormat};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateParts {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

#[derive(Debug, Clone, Default)]
pub struct TokenValues {
    pub name: String,
    pub camera: String,
    pub lens: String,
    pub iso: String,
    pub fnumber: String,
    pub shutter: String,
    pub focal: String,
    pub width: u32,
    pub height: u32,
    pub preset: String,
    pub date: Option<DateParts>,
}

pub fn extension(format: RasterFormat) -> &'static str {
    match format {
        RasterFormat::Jpeg => "jpg",
        RasterFormat::Png => "png",
        RasterFormat::Tiff => "tif",
        RasterFormat::Webp => "webp",
    }
}

pub fn parse_exif_datetime(value: &str) -> Option<DateParts> {
    let trimmed = value.trim();
    let mut halves = trimmed.split([' ', 'T']);
    let date = halves.next()?;
    let time = halves.next().unwrap_or("00:00:00");
    let mut date_parts = date.split([':', '-', '/']);
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    let mut time_parts = time.split([':', '.']);
    let hour = time_parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let minute = time_parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let second = time_parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    Some(DateParts {
        year,
        month,
        day,
        hour,
        minute,
        second,
    })
}

fn format_datetime(fmt: &str, parts: &DateParts) -> String {
    let chars: Vec<char> = fmt.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        let rest: String = chars[index..].iter().collect();
        if rest.starts_with("YYYY") {
            out.push_str(&format!("{:04}", parts.year));
            index += 4;
        } else if rest.starts_with("YY") {
            out.push_str(&format!("{:02}", (parts.year % 100).unsigned_abs()));
            index += 2;
        } else if rest.starts_with("MM") {
            out.push_str(&format!("{:02}", parts.month));
            index += 2;
        } else if rest.starts_with("DD") {
            out.push_str(&format!("{:02}", parts.day));
            index += 2;
        } else if rest.starts_with("HH") {
            out.push_str(&format!("{:02}", parts.hour));
            index += 2;
        } else if rest.starts_with("mm") {
            out.push_str(&format!("{:02}", parts.minute));
            index += 2;
        } else if rest.starts_with("ss") {
            out.push_str(&format!("{:02}", parts.second));
            index += 2;
        } else {
            out.push(chars[index]);
            index += 1;
        }
    }
    out
}

fn substitute(token: &str, arg: Option<&str>, values: &TokenValues, seq: u32) -> String {
    match token {
        "name" => values.name.clone(),
        "name_lower" => values.name.to_lowercase(),
        "seq" => {
            let width = arg.and_then(|value| value.parse::<usize>().ok()).unwrap_or(0);
            format!("{seq:0width$}")
        }
        "date" => values.date.as_ref().map(|parts| format_datetime(arg.unwrap_or("YYYY-MM-DD"), parts)).unwrap_or_default(),
        "time" => values.date.as_ref().map(|parts| format_datetime(arg.unwrap_or("HHmmss"), parts)).unwrap_or_default(),
        "camera" => values.camera.clone(),
        "lens" => values.lens.clone(),
        "iso" => values.iso.clone(),
        "fnumber" => values.fnumber.clone(),
        "shutter" => values.shutter.clone(),
        "focal" => values.focal.clone(),
        "width" => values.width.to_string(),
        "height" => values.height.to_string(),
        "preset" => values.preset.clone(),
        _ => String::new(),
    }
}

fn sanitize(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|ch| if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control() { '_' } else { ch })
        .collect();
    while out.ends_with(' ') || out.ends_with('.') {
        out.pop();
    }
    let trimmed = out.trim_start().to_owned();
    if trimmed.is_empty() {
        "export".to_owned()
    } else {
        trimmed
    }
}

pub fn render_stem(template: &str, values: &TokenValues, seq: u32) -> String {
    let chars: Vec<char> = template.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '{' {
            if let Some(close) = chars[index..].iter().position(|ch| *ch == '}') {
                let inner: String = chars[index + 1..index + close].iter().collect();
                let (token, arg) = match inner.split_once(':') {
                    Some((token, arg)) => (token, Some(arg)),
                    None => (inner.as_str(), None),
                };
                out.push_str(&substitute(token, arg, values, seq));
                index += close + 1;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    sanitize(&out)
}

pub fn resolve_output(dir: &Path, stem: &str, ext: &str, policy: ConflictPolicy) -> Option<PathBuf> {
    let candidate = dir.join(format!("{stem}.{ext}"));
    match policy {
        ConflictPolicy::Overwrite => Some(candidate),
        ConflictPolicy::Skip => {
            if candidate.exists() {
                None
            } else {
                Some(candidate)
            }
        }
        ConflictPolicy::Rename => {
            if !candidate.exists() {
                return Some(candidate);
            }
            for suffix in 1..10_000u32 {
                let renamed = dir.join(format!("{stem}-{suffix}.{ext}"));
                if !renamed.exists() {
                    return Some(renamed);
                }
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_values() -> TokenValues {
        TokenValues {
            name: "IMG_1234".to_owned(),
            camera: "Canon EOS 5D".to_owned(),
            lens: "EF50mm".to_owned(),
            iso: "400".to_owned(),
            fnumber: "2.8".to_owned(),
            shutter: "1/250".to_owned(),
            focal: "50mm".to_owned(),
            width: 2048,
            height: 1365,
            preset: "Punchy".to_owned(),
            date: parse_exif_datetime("2026:07:15 14:30:52"),
        }
    }

    #[test]
    fn parses_exif_datetime() {
        let parts = parse_exif_datetime("2026:07:15 14:30:52");
        assert_eq!(
            parts,
            Some(DateParts {
                year: 2026,
                month: 7,
                day: 15,
                hour: 14,
                minute: 30,
                second: 52
            })
        );
    }

    #[test]
    fn renders_date_and_sequence_tokens() {
        let values = sample_values();
        let rendered = render_stem("{date:YYYYMMDD}_{name}_{seq:4}", &values, 1);
        assert_eq!(rendered, "20260715_IMG_1234_0001");
    }

    #[test]
    fn renders_metadata_tokens() {
        let values = sample_values();
        let rendered = render_stem("{camera}_{iso}_{width}x{height}", &values, 7);
        assert_eq!(rendered, "Canon EOS 5D_400_2048x1365");
    }

    #[test]
    fn sanitizes_illegal_characters_from_shutter() {
        let values = sample_values();
        let rendered = render_stem("{name}_{shutter}s", &values, 1);
        assert_eq!(rendered, "IMG_1234_1_250s");
    }

    #[test]
    fn name_lower_and_time() {
        let values = sample_values();
        let rendered = render_stem("{name_lower}-{time:HHmmss}", &values, 1);
        assert_eq!(rendered, "img_1234-143052");
    }

    #[test]
    fn empty_template_falls_back() {
        let values = TokenValues::default();
        let rendered = render_stem("", &values, 1);
        assert_eq!(rendered, "export");
    }
}
