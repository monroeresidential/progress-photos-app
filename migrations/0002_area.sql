ALTER TABLE photos ADD COLUMN area TEXT;
CREATE INDEX photos_area ON photos (project_slug, area);
