use wasm_bindgen::prelude::*;

mod stats;

#[wasm_bindgen]
pub struct EntropyResult {
    pub variance: f64,
    pub std_dev: f64,
    pub kl_divergence: f64,
    pub shapiro_wilk_w: f64,
    pub sample_count: usize,
}

#[wasm_bindgen]
impl EntropyResult {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            variance: 0.0,
            std_dev: 0.0,
            kl_divergence: 0.0,
            shapiro_wilk_w: 0.0,
            sample_count: 0,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn variance(&self) -> f64 {
        self.variance
    }

    #[wasm_bindgen(getter)]
    pub fn std_dev(&self) -> f64 {
        self.std_dev
    }

    #[wasm_bindgen(getter)]
    pub fn kl_divergence(&self) -> f64 {
        self.kl_divergence
    }

    #[wasm_bindgen(getter)]
    pub fn shapiro_wilk_w(&self) -> f64 {
        self.shapiro_wilk_w
    }

    #[wasm_bindgen(getter)]
    pub fn sample_count(&self) -> usize {
        self.sample_count
    }

    #[wasm_bindgen]
    pub fn to_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(self)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub fn analyze_frame_deltas(deltas: &[f64]) -> Result<JsValue, JsValue> {
    if deltas.is_empty() {
        return Err(JsValue::from_str("Input array cannot be empty"));
    }

    if deltas.len() < 3 {
        return Err(JsValue::from_str("At least 3 samples required for statistical analysis"));
    }

    let variance = stats::welford_variance(deltas);
    let std_dev = variance.sqrt();
    let kl_divergence = stats::kl_divergence_laplace(deltas);
    let shapiro_wilk_w = stats::royston_shapiro_wilk(deltas);

    let result = EntropyResult {
        variance,
        std_dev,
        kl_divergence,
        shapiro_wilk_w,
        sample_count: deltas.len(),
    };

    JsValue::from_serde(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn is_virtual_camera(deltas: &[f64]) -> bool {
    if deltas.len() < 10 {
        return false;
    }

    let variance = stats::welford_variance(deltas);
    variance < 12.0
}

#[wasm_bindgen]
pub fn get_confidence_score(deltas: &[f64]) -> f64 {
    if deltas.len() < 10 {
        return 0.0;
    }

    let variance = stats::welford_variance(deltas);
    let kl_div = stats::kl_divergence_laplace(deltas);
    let shapiro_w = stats::royston_shapiro_wilk(deltas);

    let variance_score = if variance >= 50.0 && variance <= 500.0 {
        1.0 - ((variance - 275.0).abs() / 225.0).min(1.0)
    } else if variance < 12.0 {
        0.0
    } else {
        0.5
    };

    let kl_score = (1.0 - kl_div.min(1.0)).max(0.0);
    let shapiro_score = shapiro_w;

    (variance_score * 0.4 + kl_score * 0.3 + shapiro_score * 0.3) * 100.0
}
