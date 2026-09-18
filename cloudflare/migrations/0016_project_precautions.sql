-- Issue #41: Creator-provided install precautions.
-- Plain text only; Workshop controls rendering and does not execute content.

ALTER TABLE projects ADD COLUMN precautions TEXT;
