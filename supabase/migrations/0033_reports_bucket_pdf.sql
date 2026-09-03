-- 0031_reports_bucket.sql configured the "reports" bucket for the
-- report's JSON snapshot, back when that was the only file uploaded
-- there. lib/reports/pdf.ts (added after 0031 shipped) now renders and
-- uploads the actual report as a PDF (lib/reports/generate-supabase.ts's
-- uploadReportFile, contentType: "application/pdf") — Storage's own
-- bucket-level MIME allowlist would silently reject every one of those
-- uploads against 0031's original array['application/json']. Widening
-- the allowlist here, in a new migration, rather than editing 0031 in
-- place: 0031 already shipped in an earlier commit, and this repo's own
-- convention (see 0032_scoring_weights.sql's RPC signature change) is
-- to correct an already-shipped migration with a follow-up statement,
-- never a rewrite.
update storage.buckets
set allowed_mime_types = array['application/pdf']
where id = 'reports';
