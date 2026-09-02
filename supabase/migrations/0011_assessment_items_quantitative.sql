-- The Accommodation template's mandatory quantitative fields (location,
-- capacity, occupancy, area per resident, etc.) are captured per area
-- regardless of the Yes/No/Unclear/Not Applicable answer given for that
-- area — i.e. at the assessment_item level, not tied to one question.
-- assessment_answers.quantitative (0004_assessments.sql) is the wrong
-- home for this: it's scoped to one question, and this data isn't.
alter table public.assessment_items add column quantitative jsonb;
