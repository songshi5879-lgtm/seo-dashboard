# SEO 数据看板

线上地址：https://songshi5879-lgtm.github.io/seo-dashboard/

- `site/`：看板网页（GitHub Pages 自动发布），数据读自 Supabase。内容追踪、关键词监控、博客数据总结表可由管理员在网页上直接编辑。
- `pipeline/`：月度数据处理脚本，把 GSC、Looker Studio、GA4、Semrush 原始导出变成看板导入文件。
- `supabase/migrations/`：数据库表、权限和函数，与线上项目一致。
- `templates/`：每月要填的模板。
- `docs/月度数据导入说明.md`：每月操作步骤和口径。

原始导出（inputs/）和处理结果（out/）不提交到仓库。
