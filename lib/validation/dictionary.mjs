// Data dictionary for /methodology: the measures the screens show and where each comes from.
export const DICTIONARY = [
  { term: "Task label", meaning: "automate, augment, or unaffected: one model judgment per O*NET task statement under the exposure rubric.", source: "fow.task_exposure_scores" },
  { term: "Task exposure", meaning: "1.0 for automate, 0.5 for augment, 0.0 for unaffected.", source: "fow.task_exposure_scores.exposure" },
  { term: "Job exposure score", meaning: "Sum over a job's tasks of time share x task exposure. Time shares come from O*NET task importance and frequency and sum to 1 per job.", source: "fow.v_job_exposure" },
  { term: "Function exposure", meaning: "Job scores rolled up by headcount or by labor cost (the weighting toggle). Cost-weighted is the default.", source: "fow.v_function_exposure" },
  { term: "Automate / augment share", meaning: "Share of task time labeled automate or augment, shown as the stacked bars on the Exposure screen.", source: "fow.v_job_exposure, fow.v_function_exposure" },
  { term: "Weekly active AI user", meaning: "An employee with at least one active day on an approved AI tool in the latest usage week, as a share of headcount (or of licensed employees on the KPI tile).", source: "fow.v_exposure_adoption" },
  { term: "Flagged for redesign", meaning: "A job whose exposure score is 65% or higher.", source: "fow.v_job_exposure" },
  { term: "Enable first", meaning: "More exposed and less adopted than the company overall.", source: "fow.v_exposure_adoption" },
  { term: "Pulse favorable", meaning: "Share of responses scoring 4 or 5, after flipping the reverse-scored worry question.", source: "fow.v_pulse_sentiment" },
  { term: "Overdue review", meaning: "A use case whose earliest next review date has passed.", source: "fow.v_register" },
  { term: "Suppression", meaning: "Any group under 10 people is hidden or has its employee-derived measures blanked. Employee-level rows never reach the browser.", source: "fow.min_group_size()" },
  { term: "Percent agreement", meaning: "Share of sampled tasks where the reviewer's label equals the model's label.", source: "fow.score_reviews" },
  { term: "Cohen's kappa", meaning: "Agreement beyond what chance would give, given how often each rater uses each label. 0 is chance, 1 is perfect.", source: "fow.score_reviews" },
  { term: "Stability", meaning: "Share of 50 re-scored tasks that get the same label on a second pass with the same prompt.", source: "fow.retest_scores" },
];

export const LIMITS = [
  "Exposure measures how much task time overlaps with what current AI tools can do. It is not a forecast of job loss, and it says nothing about timing.",
  "Labels are one model's judgment of O*NET task statements, not observations of how work is done at this company. Task text is generic to the occupation.",
  "Time shares come from O*NET importance and frequency ratings, not time studies, so job scores are estimates.",
  "The validation sample is stratified by the model's label, so every label is checked. Its raw agreement is not the overall accuracy; the weighted figure reweights each label by how many tasks the model gave it.",
  "One reviewer labeled the sample, so kappa shows agreement with that person, not between independent experts.",
  "The rubric measures what widely available tools do today. It will drift as tools improve, which is why every run records its model, prompt hash, and rubric version.",
  "All employee data is synthetic, so adoption, sentiment, and workforce figures show how the tool works, not real findings.",
];
