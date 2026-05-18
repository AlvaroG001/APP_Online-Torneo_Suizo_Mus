/* eslint-disable @next/next/no-img-element */

type TournamentWatermarkProps = {
  variant?: "default" | "swiss" | "mobile";
};

export function TournamentWatermark({ variant = "default" }: TournamentWatermarkProps) {
  const logoStyle =
    variant === "swiss"
      ? {
          width: "min(42vw, 36rem)",
          maxWidth: "74vw",
          maxHeight: "46vh",
          objectFit: "contain" as const,
          opacity: 0.18,
          filter: "saturate(0.82) brightness(1.12) contrast(1.04)",
        }
      : variant === "mobile"
        ? {
            width: "min(78vw, 24rem)",
            maxWidth: "74vw",
            maxHeight: "42vh",
            objectFit: "contain" as const,
            opacity: 0.08,
            filter: "saturate(0.82) brightness(1.12) contrast(1.04)",
          }
        : {
            width: "min(48vw, 42rem)",
            maxWidth: "74vw",
            maxHeight: "54vh",
            objectFit: "contain" as const,
            opacity: 0.14,
            filter: "saturate(0.82) brightness(1.12) contrast(1.04)",
          };

  return (
    <div
      className={`tournament-watermark tournament-watermark--${variant}`}
      aria-hidden="true"
      style={{
        pointerEvents: "none",
        position: "absolute",
        inset: 0,
        zIndex: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img className="tournament-watermark__logo" src="/logo_torneo.png" alt="" style={logoStyle} />
    </div>
  );
}
