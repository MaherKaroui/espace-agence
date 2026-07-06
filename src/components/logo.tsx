import logo from "@/assets/logo-izisuivis-icon.png";

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 36, className }: LogoProps) {
  return (
    <img
      src={logo}
      alt="IZISuivis"
      width={size}
      height={size}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}
