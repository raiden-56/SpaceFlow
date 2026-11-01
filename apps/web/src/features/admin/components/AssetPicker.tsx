import { useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import type { AssetKind } from '@spaceflow/shared';
import { useAssetsQuery, useUploadAssetMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';

const ACCEPT: Record<AssetKind, string> = { BUILDING_MODEL: '.glb', FLOOR_MODEL: '.glb', FLOOR_PLAN_IMAGE: '.png,.jpg,.jpeg,.svg' };

/** Choose an existing uploaded asset of a kind or upload a new one. Validation + size limits are enforced server-side. */
export function AssetPicker({ kind, value, onChange, label }: { kind: AssetKind; value: string | null; onChange: (assetId: string | null) => void; label: string }) {
  const { data: assets, isLoading } = useAssetsQuery();
  const [upload, { isLoading: uploading }] = useUploadAssetMutation();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = (assets ?? []).filter((a) => a.kind === kind);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const asset = await upload({ file, kind }).unwrap();
      onChange(asset.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <FormControl size="small" fullWidth>
          <InputLabel id={`asset-${kind}`}>{label}</InputLabel>
          <Select labelId={`asset-${kind}`} label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value ? String(e.target.value) : null)} disabled={isLoading}>
            <MenuItem value="">None</MenuItem>
            {list.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.fileName} · {(a.sizeBytes / 1024 / 1024).toFixed(2)} MB
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button component="label" variant="outlined" startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileRoundedIcon />} disabled={uploading} sx={{ whiteSpace: 'nowrap' }}>
          Upload
          <input ref={inputRef} hidden type="file" accept={ACCEPT[kind]} onChange={(e) => onFile(e.target.files?.[0])} aria-label={`Upload ${label}`} />
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Allowed: {ACCEPT[kind]} · files are validated server-side (magic bytes, no scripts) and limited in size.
        {value && (
          <>
            {' '}
            <Chip size="small" label="Selected" color="primary" variant="outlined" sx={{ ml: 0.5 }} />
          </>
        )}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
