use std::io::BufReader;
use std::path::Path;

use exif::{Exif, In, Reader, Tag, Value};

pub struct ExifData {
    exif: Option<Exif>,
    pub errored: bool,
}

impl ExifData {
    pub fn read(path: &Path) -> Self {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(_) => {
                return Self { exif: None, errored: false };
            }
        };
        let mut buffer = BufReader::new(file);
        let mut reader = Reader::new();
        reader.continue_on_error(true);
        match reader.read_from_container(&mut buffer) {
            Ok(exif) => Self { exif: Some(exif), errored: false },
            Err(exif::Error::PartialResult(partial)) => {
                let (exif, _errors) = partial.into_inner();
                Self { exif: Some(exif), errored: true }
            }
            Err(exif::Error::NotFound(_)) => Self { exif: None, errored: false },
            Err(_) => Self { exif: None, errored: true },
        }
    }

    pub fn has_exif(&self) -> bool {
        self.exif.is_some()
    }

    pub fn value(&self, tag: Tag) -> Option<&Value> {
        self.exif.as_ref()?.get_field(tag, In::PRIMARY).map(|field| &field.value)
    }

    pub fn string(&self, tag: Tag) -> Option<String> {
        ascii_string(self.value(tag)?)
    }

    pub fn float(&self, tag: Tag) -> Option<f64> {
        first_f64(self.value(tag)?)
    }

    pub fn uint(&self, tag: Tag) -> Option<u32> {
        self.value(tag)?.get_uint(0)
    }

    pub fn urational(&self, tag: Tag) -> Option<(u32, u32)> {
        match self.value(tag)? {
            Value::Rational(list) => list.first().map(|value| (value.num, value.denom)),
            _ => None,
        }
    }

    pub fn rationals(&self, tag: Tag) -> Option<Vec<f64>> {
        match self.value(tag)? {
            Value::Rational(list) => Some(list.iter().map(|value| value.to_f64()).collect()),
            Value::SRational(list) => Some(list.iter().map(|value| value.to_f64()).collect()),
            _ => None,
        }
    }
}

pub fn ascii_string(value: &Value) -> Option<String> {
    match value {
        Value::Ascii(parts) => {
            let joined: Vec<String> = parts.iter().map(|part| String::from_utf8_lossy(part).into_owned()).collect();
            let text = joined.join(" ").trim().trim_matches('\0').trim().to_owned();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn first_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Rational(list) => list.first().map(|entry| entry.to_f64()),
        Value::SRational(list) => list.first().map(|entry| entry.to_f64()),
        Value::Short(list) => list.first().map(|entry| *entry as f64),
        Value::Long(list) => list.first().map(|entry| *entry as f64),
        Value::SShort(list) => list.first().map(|entry| *entry as f64),
        Value::SLong(list) => list.first().map(|entry| *entry as f64),
        Value::Float(list) => list.first().map(|entry| *entry as f64),
        Value::Double(list) => list.first().copied(),
        _ => None,
    }
}
