-- Only approvals made with a bound code snapshot establish a baseline.
-- Existing approvals intentionally stay NULL; no risk is inferred as accepted.
ALTER TABLE projects ADD COLUMN accepted_code_check TEXT;
ALTER TABLE projects ADD COLUMN content_mutation_token TEXT;
