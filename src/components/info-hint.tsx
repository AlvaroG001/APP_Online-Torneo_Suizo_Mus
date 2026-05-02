interface InfoHintProps {
  label: string;
}

export function InfoHint({ label }: InfoHintProps) {
  return (
    <span className="info-hint">
      <button type="button" className="info-hint-trigger" aria-label={label}>
        ?
      </button>
      <span className="info-hint-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  );
}
