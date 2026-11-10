-- Allow manual entry in the department monthly table (12 sites x 11 rows) from the dashboard.
alter table public.seo_cell_overrides drop constraint seo_cell_overrides_grid_check;
alter table public.seo_cell_overrides add constraint seo_cell_overrides_grid_check
  check (grid in ('blog_summary','keywords','monthly'));
