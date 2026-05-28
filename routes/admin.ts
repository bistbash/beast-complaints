import { Router } from 'express';
import { authenticateBeastUser, requireAdmin } from '../middleware/auth.ts';
import { importLegacyTsv, isLegacyImportEnabled } from '../services/legacyImport.ts';

const router = Router();

router.post('/legacy-import', authenticateBeastUser, requireAdmin, async (req, res) => {
  if (!isLegacyImportEnabled()) {
    res.status(404).json({ error: 'ייבוא מערכת ישנה מושבת (LEGACY_IMPORT_ENABLED=false)' });
    return;
  }

  const content = req.body?.content;
  const dryRun = req.body?.dryRun === true;

  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'נדרש שדה content עם תוכן הקובץ (TSV)' });
    return;
  }

  try {
    const result = await importLegacyTsv(content, { dryRun });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בייבוא';
    res.status(400).json({ error: message });
  }
});

export default router;
