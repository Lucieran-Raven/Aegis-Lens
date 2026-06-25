
pub fn welford_variance(samples: &[f64]) -> f64 {
    if samples.len() < 2 {
        return 0.0;
    }

    let mut mean = samples[0];
    let mut m2 = 0.0;

    for (i, &x) in samples.iter().enumerate().skip(1) {
        let delta = x - mean;
        let delta_n = delta / (i as f64 + 1.0);
        mean += delta_n;
        let delta_n2 = delta * (x - mean);
        m2 += delta_n2;
    }

    if samples.len() > 1 {
        m2 / (samples.len() as f64 - 1.0)
    } else {
        0.0
    }
}

const VIRTUAL_CAM_Q: [f64; 20] = [
    0.85, 0.10, 0.03, 0.01, 0.005, 0.003, 0.002, 0.001, 0.001, 0.001,
    0.001, 0.001, 0.001, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
];

pub fn kl_divergence_laplace(samples: &[f64]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }

    let epsilon = 1e-10;
    let bin_count = VIRTUAL_CAM_Q.len();
    let mut histogram_p = vec![0.0; bin_count];
    let mut total = 0.0;

    let max_delta = samples.iter().cloned().fold(f64::NAN, f64::max);
    let bin_width = (max_delta / bin_count as f64).max(1.0);

    for &sample in samples {
        let bin_idx = ((sample / bin_width) as usize).min(bin_count - 1);
        histogram_p[bin_idx] += 1.0;
        total += 1.0;
    }

    if total == 0.0 {
        return 0.0;
    }

    let alpha = 1.0;
    let smoothed_total = total + (alpha * bin_count as f64);
    for p in histogram_p.iter_mut() {
        *p = (*p + alpha) / smoothed_total;
    }

    let mut kl_div = 0.0;
    for (p, q) in histogram_p.iter().zip(VIRTUAL_CAM_Q.iter()) {
        let q_smoothed = q.max(epsilon);
        if *p > epsilon {
            kl_div += *p * (*p / q_smoothed).ln();
        }
    }

    kl_div
}

pub fn royston_shapiro_wilk(samples: &[f64]) -> f64 {
    let n = samples.len();
    
    if n < 3 {
        return 0.0;
    }
    
    if n > 89 {
        return shapiro_wilk_approximation(samples);
    }

    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let w = compute_shapiro_wilk_statistic(&sorted);
    
    w
}

fn compute_shapiro_wilk_statistic(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    
    if n < 3 {
        return 0.0;
    }

    let mean: f64 = sorted.iter().sum();
    let mean = mean / n as f64;

    let ss: f64 = sorted.iter().map(|x| (x - mean).powi(2)).sum();
    
    if ss == 0.0 {
        return 0.0;
    }

    let weights = generate_normal_weights(n);
    
    let mut numerator = 0.0;
    for (i, &x) in sorted.iter().enumerate() {
        numerator += weights[i] * x;
    }
    numerator = numerator.powi(2);

    numerator / ss
}

fn generate_normal_weights(n: usize) -> Vec<f64> {
    let mut weights = Vec::with_capacity(n);
    
    for i in 1..=n {
        let p = (i as f64 - 0.375) / (n as f64 + 0.25);
        let z = normal_quantile(p);
        weights.push(z);
    }

    let mean_w: f64 = weights.iter().sum();
    let mean_w = mean_w / n as f64;
    for w in weights.iter_mut() {
        *w -= mean_w;
    }

    weights
}

fn normal_quantile(p: f64) -> f64 {
    let a = [0.0, -3.969683028665376e+01, 2.209460984245205e+02,
             -2.759285104469687e+02, 1.383577518672690e+02,
             -3.066479806614716e+01, 2.506628277459239e+00];
    
    let b = [0.0, -5.447609879822406e+01, 1.615858368580409e+02,
             -1.556989798598866e+02, 6.680131188771972e+01,
             -1.328068155288572e+01];
    
    let c = [0.0, -7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00, 2.938163982698783e+00];
    
    let d = [0.0, 7.784695709041462e-03, 3.224671290700398e-01,
              2.445134137142996e+00, 3.754408661907416e+00];

    let q = p - 0.5;
    let r = q.abs();

    if r <= 0.23 {
        let t = q * q;
        (q * (((((a[7]*t + a[6])*t + a[5])*t + a[4])*t + a[3])*t + a[2])*t + a[1])*t + a[0]) / (((((b[6]*t + b[5])*t + b[4])*t + b[3])*t + b[2])*t + b[1])*t + 1.0)
    } else if r <= 0.46 {
        let t = r - 0.25;
        let sign = if q < 0.0 { -1.0 } else { 1.0 };
        (sign * (((((c[7]*t + c[6])*t + c[5])*t + c[4])*t + c[3])*t + c[2])*t + c[1])*t + c[0]) / (((((d[6]*t + d[5])*t + d[4])*t + d[3])*t + d[2])*t + d[1])*t + 1.0)
    } else {
        let t = if q < 0.0 { p } else { 1.0 - p };
        let sign = if q < 0.0 { -1.0 } else { 1.0 };
        let u = t.sqrt().ln();
        (sign * (((((c[7]*u + c[6])*u + c[5])*u + c[4])*u + c[3])*u + c[2])*u + c[1])*u + c[0]) / (((((d[6]*u + d[5])*u + d[4])*u + d[3])*u + d[2])*u + d[1])*u + 1.0)
    }
}

fn shapiro_wilk_approximation(samples: &[f64]) -> f64 {
    let n = samples.len();
    let variance = welford_variance(samples);
    let std_dev = variance.sqrt();
    
    if std_dev == 0.0 {
        return 0.0;
    }

    let mean: f64 = samples.iter().sum::<f64>() / n as f64;
    let skewness: f64 = samples.iter()
        .map(|x| ((x - mean) / std_dev).powi(3))
        .sum::<f64>() / n as f64;

    let kurtosis: f64 = samples.iter()
        .map(|x| ((x - mean) / std_dev).powi(4))
        .sum::<f64>() / n as f64 - 3.0;

    let skew_score = (1.0 - skewness.abs().min(1.0)).max(0.0);
    let kurt_score = (1.0 - kurtosis.abs().min(1.0)).max(0.0);
    
    (skew_score * 0.5 + kurt_score * 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_welford_variance() {
        let samples = vec![100.0, 150.0, 200.0, 250.0, 300.0];
        let variance = welford_variance(&samples);
        assert!(variance > 0.0);
    }

    #[test]
    fn test_empty_samples() {
        assert_eq!(welford_variance(&[]), 0.0);
        assert_eq!(kl_divergence_laplace(&[]), 0.0);
    }

    #[test]
    fn test_shapiro_wilk() {
        let normal_samples: Vec<f64> = (0..50).map(|_| rand::random::<f64>() * 100.0).collect();
        let w = royston_shapiro_wilk(&normal_samples);
        assert!(w >= 0.0 && w <= 1.0);
    }
}
