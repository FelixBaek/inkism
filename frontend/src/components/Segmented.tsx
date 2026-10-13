/** 세그먼트 컨트롤: 1px 틀 안의 칸 중 하나를 고른다. 고른 칸은 --active 면. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<{ label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className="segmented-item" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
