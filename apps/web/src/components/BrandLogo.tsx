import { Image, useComputedColorScheme } from '@mantine/core';

/** Ricoman logo; the white-lettered version is used on dark backgrounds. */
export function BrandLogo({ h = 24 }: { h?: number }) {
  const scheme = useComputedColorScheme('light');
  return (
    <Image
      src={scheme === 'dark' ? '/brand/ricoman-logo-dark.png' : '/brand/ricoman-logo.png'}
      alt="Ricoman"
      h={h}
      w="auto"
      fit="contain"
    />
  );
}
