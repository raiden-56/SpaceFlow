import { createTheme, alpha } from '@mui/material/styles';
import { PALETTE, STATUS_COLORS } from '@spaceflow/shared';

declare module '@mui/material/styles' {
  interface Palette {
    status: { available: string; selected: string; occupied: string; reserved: string; restricted: string; disabled: string; focus: string };
  }
  interface PaletteOptions {
    status?: Palette['status'];
  }
}

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: PALETTE.primary, dark: PALETTE.primaryDark, light: '#818CF8', contrastText: '#FFFFFF' },
    secondary: { main: '#0EA5E9' },
    background: { default: PALETTE.background, paper: PALETTE.surface },
    text: { primary: PALETTE.text, secondary: PALETTE.textSecondary },
    divider: PALETTE.border,
    success: { main: STATUS_COLORS.AVAILABLE },
    error: { main: STATUS_COLORS.OCCUPIED },
    warning: { main: STATUS_COLORS.RESTRICTED },
    info: { main: STATUS_COLORS.FOCUS },
    status: {
      available: STATUS_COLORS.AVAILABLE,
      selected: STATUS_COLORS.SELECTED,
      occupied: STATUS_COLORS.OCCUPIED,
      reserved: STATUS_COLORS.RESERVED,
      restricted: STATUS_COLORS.RESTRICTED,
      disabled: STATUS_COLORS.DISABLED,
      focus: STATUS_COLORS.FOCUS,
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25 },
    h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },
    h4: { fontSize: '1.125rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.9375rem', fontWeight: 600 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600, color: PALETTE.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    caption: { fontSize: '0.75rem', color: PALETTE.textSecondary },
    button: { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem' },
    overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: PALETTE.background },
        '*:focus-visible': { outline: `3px solid ${STATUS_COLORS.FOCUS}`, outlineOffset: 2, borderRadius: 4 },
        '@media (prefers-reduced-motion: reduce)': { '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        sizeSmall: { minHeight: 32, paddingInline: 12 },
        root: { borderRadius: 10, paddingInline: 16, minHeight: 40, transition: 'transform 120ms ease, background-color 120ms ease', '&:active': { transform: 'scale(0.98)' }, '&.MuiButton-containedPrimary:hover': { backgroundColor: PALETTE.primaryDark } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: PALETTE.border } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: `1px solid ${PALETTE.border}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(23,32,51,0.04)' } },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 10, backgroundColor: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: PALETTE.border } },
      },
    },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600, fontSize: '0.75rem' } } },
    MuiTooltip: { defaultProps: { arrow: true }, styleOverrides: { tooltip: { fontSize: '0.75rem', backgroundColor: PALETTE.text } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiDrawer: { styleOverrides: { paper: { borderColor: PALETTE.border } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: PALETTE.border }, head: { fontWeight: 600, color: PALETTE.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#F8FAFC' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          '&.Mui-selected': { backgroundColor: alpha(PALETTE.primary, 0.1), color: PALETTE.primary, '& .MuiListItemIcon-root': { color: PALETTE.primary } },
          '&.Mui-selected:hover': { backgroundColor: alpha(PALETTE.primary, 0.14) },
        },
      },
    },
    MuiSkeleton: { styleOverrides: { root: { borderRadius: 8 } } },
  },
});

export const statusColor = (state: keyof typeof STATUS_COLORS | string): string =>
  (STATUS_COLORS as Record<string, string>)[state] ?? STATUS_COLORS.DISABLED;
