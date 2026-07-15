use exif::Tag;

use crate::meta::exif::ExifData;
use crate::types_meta::GpsMeta;

fn dms_to_degrees(parts: &[f64]) -> Option<f64> {
    let degrees = *parts.first()?;
    let minutes = parts.get(1).copied().unwrap_or(0.0);
    let seconds = parts.get(2).copied().unwrap_or(0.0);
    Some(degrees + minutes / 60.0 + seconds / 3600.0)
}

fn signed(value: f64, reference: Option<&str>, negative: &str) -> f64 {
    match reference {
        Some(text) if text.trim().eq_ignore_ascii_case(negative) => -value,
        _ => value,
    }
}

pub fn from_exif(exif: &ExifData) -> Option<GpsMeta> {
    let lat_parts = exif.rationals(Tag::GPSLatitude)?;
    let lng_parts = exif.rationals(Tag::GPSLongitude)?;
    let lat = signed(dms_to_degrees(&lat_parts)?, exif.string(Tag::GPSLatitudeRef).as_deref(), "S");
    let lng = signed(dms_to_degrees(&lng_parts)?, exif.string(Tag::GPSLongitudeRef).as_deref(), "W");
    if !lat.is_finite() || !lng.is_finite() {
        return None;
    }

    let alt = exif.float(Tag::GPSAltitude).map(|value| {
        let below = exif.uint(Tag::GPSAltitudeRef).is_some_and(|reference| reference == 1);
        if below {
            -value
        } else {
            value
        }
    });
    let alt_ref = alt.map(|_| "sea".to_owned());

    let direction = exif.float(Tag::GPSImgDirection);
    let direction_ref = exif.string(Tag::GPSImgDirectionRef).map(|reference| {
        if reference.trim().eq_ignore_ascii_case("M") {
            "magnetic".to_owned()
        } else {
            "true".to_owned()
        }
    });

    let speed = exif.float(Tag::GPSSpeed);

    let timestamp = build_timestamp(exif);
    let processing_method = exif.string(Tag::GPSProcessingMethod);
    let dop = exif.float(Tag::GPSDOP);

    Some(GpsMeta {
        lat,
        lng,
        alt,
        alt_ref,
        direction,
        direction_ref,
        speed,
        timestamp,
        processing_method,
        dop,
    })
}

fn build_timestamp(exif: &ExifData) -> Option<String> {
    let date = exif.string(Tag::GPSDateStamp);
    let time = exif.rationals(Tag::GPSTimeStamp).and_then(|parts| {
        let hours = *parts.first()? as u32;
        let minutes = parts.get(1).copied().unwrap_or(0.0) as u32;
        let seconds = parts.get(2).copied().unwrap_or(0.0) as u32;
        Some(format!("{hours:02}:{minutes:02}:{seconds:02}"))
    });
    match (date, time) {
        (Some(date), Some(time)) => Some(format!("{} {} UTC", date.replace(':', "-"), time)),
        (Some(date), None) => Some(date.replace(':', "-")),
        (None, Some(time)) => Some(format!("{time} UTC")),
        (None, None) => None,
    }
}
