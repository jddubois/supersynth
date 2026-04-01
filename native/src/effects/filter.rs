/// Common trait for all DSP effect filters.
pub trait Filter: Send {
    fn process(&mut self, input: f32) -> f32;
    #[allow(dead_code)]
    fn reset(&mut self) {}
}
