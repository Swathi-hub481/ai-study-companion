-- Evaluation suites get their own AiFeature value.
--
-- Without it, evaluation calls would be recorded under whichever learner-facing feature
-- they happened to exercise, inflating that feature's usage and cost in the analytics and
-- admin views.

ALTER TYPE "AiFeature" ADD VALUE 'EVAL';
