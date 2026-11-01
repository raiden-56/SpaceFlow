import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useImportResourcesMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { downloadFile } from './authFetch';

type ImportResult = { dryRun: boolean; valid: number; errors: { row: number; message: string }[]; created: number; updated: number };

export function CsvImportDialog({ open, onClose, buildingId, buildingName, type }: { open: boolean; onClose: () => void; buildingId: string; buildingName: string; type: 'seats' | 'rooms' }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [importRows, { isLoading }] = useImportResourcesMutation();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setError(null);
    try {
      const res = await importRows({ buildingId, file, type, dryRun }).unwrap();
      setPreview(res);
      if (!dryRun) {
        toast.success(`Imported ${res.created} new and ${res.updated} updated ${type}`);
        onClose();
      }
    } catch (err) {
      // 422 returns the validation report as the body; surface it.
      const data = (err as { data?: ImportResult }).data;
      if (data && Array.isArray(data.errors)) setPreview(data);
      else setError(errorMessage(err));
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
  };

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} fullWidth maxWidth="sm" aria-labelledby="csv-import-title">
      <DialogTitle id="csv-import-title">Import {type} into {buildingName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Upload a CSV following the template. Rows are matched by code: existing resources are updated (booking history is kept), new codes are created. Coordinates (x, y) place objects on the floor plan when a plan exists. Run a dry run first to validate.
          </Typography>
          <Link component="button" type="button" variant="body2" onClick={() => downloadFile(`/admin/buildings/${buildingId}/import/template?type=${type}`, `spaceflow-${type}-template.csv`).catch((e) => setError(e.message))}>
            Download the CSV template
          </Link>
          <Button component="label" variant="outlined">
            {file ? file.name : 'Choose CSV file'}
            <input hidden type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} aria-label="CSV file" />
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          {preview && (
            <Box aria-live="polite">
              <Alert severity={preview.errors.length ? 'error' : 'success'}>
                {preview.errors.length ? `${preview.errors.length} row(s) have problems. Fix them and upload again.` : `${preview.valid} valid row(s). ${preview.dryRun ? 'Ready to import.' : `Created ${preview.created}, updated ${preview.updated}.`}`}
              </Alert>
              {preview.errors.length > 0 && (
                <Box sx={{ maxHeight: 220, overflow: 'auto', mt: 1 }}>
                  <Table size="small" aria-label="Import errors">
                    <TableHead>
                      <TableRow>
                        <TableCell>Row</TableCell>
                        <TableCell>Problem</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.errors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.row}</TableCell>
                          <TableCell>{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={() => { reset(); onClose(); }}>
          Close
        </Button>
        <Button variant="outlined" disabled={!file || isLoading} onClick={() => run(true)}>
          Dry run
        </Button>
        <Button variant="contained" disabled={!file || isLoading || !preview || !!preview.errors.length} onClick={() => run(false)}>
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
