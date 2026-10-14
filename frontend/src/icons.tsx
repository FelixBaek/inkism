// Felix DS: 아이콘은 Phosphor Regular. 기존 lucide 이름을 그대로 내보내 화면 코드 변경을 import 경로로 한정한다.
import type { ComponentType, SVGProps } from "react";
import { SidebarSimpleIcon as SidebarSimple, type IconProps } from "@phosphor-icons/react";

export type LucideIcon = ComponentType<IconProps>;

export const PanelRight = (props: IconProps) => <SidebarSimple mirrored {...props} />;

const customIcon = (paths: string[]) =>
  function CustomIcon({ size = 16, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" {...(rest as SVGProps<SVGSVGElement>)}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
/** 아래·위 첨자: 큰 A 옆에 작은 A를 아래나 위에 그린다(x₂ 대신 글자로 알아보기 쉽게). */
const scriptIcon = (small: string) =>
  function ScriptIcon({ size = 16, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" {...(rest as SVGProps<SVGSVGElement>)}>
        <path d="M1.5 13 5.5 3l4 10M3 9.5h5" />
        <path d={small} />
      </svg>
    );
  };
export const SubscriptIcon = scriptIcon("M10.5 14.5 12.5 9.5l2 5M11.25 12.75h2.5");
export const SuperscriptIcon = scriptIcon("M10.5 6.5 12.5 1.5l2 5M11.25 4.75h2.5");
/** Figma Icon/sparkles-ai (40:6845): 큰 4각 별 + 작은 별 둘. */
export const SparklesAi = customIcon([
  "M6 3.4C6.448 6.685 8.315 8.552 11.6 9 8.315 9.448 6.448 11.315 6 14.6 5.552 11.315 3.685 9.448.4 9 3.685 8.552 5.552 6.685 6 3.4Z",
  "M12.2 1.5c.232 1.701 1.199 2.668 2.9 2.9-1.701.232-2.668 1.199-2.9 2.9-.232-1.701-1.199-2.668-2.9-2.9 1.701-.232 2.668-1.199 2.9-2.9Z",
  "M12.2 9.7c.232 1.701 1.199 2.668 2.9 2.9-1.701.232-2.668 1.199-2.9 2.9-.232-1.701-1.199-2.668-2.9-2.9 1.701-.232 2.668-1.199 2.9-2.9Z",
]);

export {
  ArrowSquareOutIcon as ExternalLink,
  ClipboardTextIcon as ClipboardText,
  ClipboardIcon as Clipboard,
  SelectionAllIcon as SelectAll,
  BookOpenTextIcon as BookOpenText,
  NotePencilIcon as NotePencil,
  SlidersHorizontalIcon as SlidersHorizontal,
  PencilSimpleSlashIcon as PencilOff,
  ExportIcon as ShareExport,
  FilesIcon as CopyNote,
  CircleIcon as Circle,
  PlayIcon as Play,
  PauseIcon as Pause,
  StopIcon as Stop,
  MicrophoneIcon as Microphone,
  CubeIcon as Cube,
  TreeStructureIcon as TreeStructure,
  SparkleIcon as Sparkle,
  YoutubeLogoIcon as YoutubeLogo,
  FilmSlateIcon as FilmSlate,
  MusicNotesIcon as MusicNotes,
  BracketsCurlyIcon as BracketsCurly,
  SmileyIcon as Smiley,
  VideoCameraIcon as VideoCamera,
  WaveformIcon as Waveform,
  FrameCornersIcon as FrameCorners,
  GlobeSimpleIcon as GlobeSimple,
  FileCsvIcon as FileCsv,
  FilesIcon as Files,
  CheckSquareIcon as CheckSquare,
  FunctionIcon,
  GearSixIcon as Settings,
  InfoIcon as Info,
  CloudCheckIcon as CloudCheck,
  BroomIcon as Broom,
  SortAscendingIcon as SortAscending,
  PrinterIcon as Printer,
  KeyboardIcon as Keyboard,
  WarningIcon as AlertTriangle,
  ArchiveIcon as Archive,
  BoxArrowUpIcon as ArchiveRestore,
  ArrowDownIcon as ArrowDown,
  ArrowLeftIcon as ArrowLeft,
  ArrowUpIcon as ArrowUp,
  BellIcon as Bell,
  TextBIcon as Bold,
  CheckCircleIcon as CheckCircle2,
  CaretDownIcon as ChevronDown,
  CaretLeftIcon as ChevronLeft,
  CaretRightIcon as ChevronRight,
  CaretUpIcon as ChevronUp,
  CaretUpDownIcon as ChevronsUpDown,
  CloudArrowUpIcon as CloudUpload,
  CodeIcon as Code,
  CopyIcon as Copy,
  DownloadSimpleIcon as Download,
  EyeIcon as Eye,
  FileCodeIcon as FileCode2,
  FileTextIcon as FileText,
  FileArrowUpIcon as FileUp,
  DotsSixVerticalIcon as GripVertical,
  TextHOneIcon as Heading1,
  TextHTwoIcon as Heading2,
  TextHThreeIcon as Heading3,
  HashIcon as Hash,
  HighlighterIcon as Highlighter,
  ClockCounterClockwiseIcon as History,
  HouseIcon as House,
  ImageIcon as Image,
  TextItalicIcon as Italic,
  LinkIcon as Link2,
  ListBulletsIcon as List,
  ChecksIcon as ListChecks,
  ListNumbersIcon as ListOrdered,
  CheckSquareIcon as ListTodo,
  CircleNotchIcon as Loader2,
  LockKeyIcon as LockKeyhole,
  ListIcon as Menu,
  ChatTextIcon as MessageSquare,
  MoonIcon as Moon,
  DotsThreeVerticalIcon as MoreVertical,
  FolderIcon as Folder,
  PaletteIcon as Palette,
  PaperclipIcon as Paperclip,
  PencilSimpleIcon as Pencil,
  EraserIcon as Eraser,
  PushPinIcon as Pin,
  PlusIcon as Plus,
  QuotesIcon as Quote,
  ArrowUUpRightIcon as Redo2,
  ArrowsClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as RotateCcw,
  MagnifyingGlassIcon as Search,
  FileMagnifyingGlassIcon as SearchX,
  ScissorsIcon as Scissors,
  SigmaIcon as Sigma,
  CodeBlockIcon as SquareCode,
  SquareIcon as Square,
  FunctionIcon as SquareSigma,
  StarIcon as Star,
  NoteIcon as StickyNote,
  TextStrikethroughIcon as Strikethrough,
  SunIcon as Sun,
  TableIcon as Table,
  TagIcon as Tag,
  TrashIcon as Trash2,
  TextTIcon as Type,
  TextUnderlineIcon as Underline,
  ArrowUUpLeftIcon as Undo2,
  UploadSimpleIcon as Upload,
  XIcon as X,
  MinusIcon as Minus,
  TextAlignLeftIcon as AlignLeft,
  TextAlignCenterIcon as AlignCenter,
  TextAlignRightIcon as AlignRight,
  TextAlignJustifyIcon as AlignJustify,
  TextTSlashIcon as ClearFormatting,
  FilesIcon as NoteLink,
  SmileyIcon as Smile,
  CodeSimpleIcon as InlineCode,
  TextAUnderlineIcon as TextColor,
  DropSlashIcon as NoColor,
  ProhibitIcon as Prohibit,
  MagicWandIcon as MagicWand,
  ArrowsInSimpleIcon as Shorter,
  ArrowsOutSimpleIcon as Longer,
  TranslateIcon as Translate,
  ListDashesIcon as ListDashes,
  ClockIcon as Clock,
  CheckIcon as Check,
  ListChecksIcon as TaskList,
  ChatTextIcon as ChatTone,
  ArrowUpIcon as SendUp,
} from "@phosphor-icons/react";
