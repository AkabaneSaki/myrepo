ALTER TABLE devteam_curators
  ADD COLUMN title TEXT NOT NULL DEFAULT '';

ALTER TABLE devteam_recommendations
  ADD COLUMN reaction_label TEXT NOT NULL DEFAULT '';
