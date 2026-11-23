import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  Download,
  History,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  createIcons,
} from 'lucide';
import { instalarCabecera } from './cabecera';
import { instalarMovimiento } from './movimiento';

createIcons({
  icons: {
    ArrowLeft,
    ArrowRight,
    ChartNoAxesColumnIncreasing,
    ChevronDown,
    Download,
    History,
    RefreshCw,
    Settings2,
    SlidersHorizontal,
  },
  attrs: { 'aria-hidden': 'true', focusable: 'false' },
});
instalarCabecera(document);
instalarMovimiento(document);
