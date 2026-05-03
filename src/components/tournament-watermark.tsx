/* eslint-disable @next/next/no-img-element */

type TournamentWatermarkProps = {
  variant?: "default" | "swiss" | "mobile";
};

export function TournamentWatermark({ variant = "default" }: TournamentWatermarkProps) {
  return (
    <div className={`tournament-watermark tournament-watermark--${variant}`} aria-hidden="true">
      <img className="tournament-watermark__logo" src="/logo_torneo.png" alt="" />
    </div>
  );
}
