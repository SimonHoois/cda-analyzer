import {
  Wind, Upload, Scissors, CheckCircle2, AlertTriangle, XCircle, Trash2, ChevronDown, ChevronUp,
  RefreshCw, ArrowLeftRight, Plus, ArrowLeft, ArrowRight, Loader2, Play, Pause, Info, Check,
  Sun, Moon, Download, X,
} from 'lucide-react'

const MAP = {
  wind: Wind, upload: Upload, scissors: Scissors, ok: CheckCircle2, alert: AlertTriangle, bad: XCircle,
  trash: Trash2, down: ChevronDown, up: ChevronUp, refresh: RefreshCw, compare: ArrowLeftRight,
  plus: Plus, left: ArrowLeft, right: ArrowRight, loader: Loader2, play: Play, pause: Pause,
  info: Info, check: Check, sun: Sun, moon: Moon, download: Download, close: X,
}

export default function Icon({ name, size = 16, className = '' }) {
  const C = MAP[name]
  return <C size={size} className={`ico ${name === 'loader' ? 'spin ' : ''}${className}`} aria-hidden="true" />
}
