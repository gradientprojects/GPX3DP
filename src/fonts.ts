import atkinson from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff?url';
import barlow from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff?url';
import inter from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import jetbrains from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff?url';
import nunito from '@fontsource/nunito/files/nunito-latin-800-normal.woff?url';
import robotoSlab from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url';

/** Label fonts: bold weights only (thin strokes close up in a deboss). All OFL except Roboto Slab (Apache-2.0). */
export const LABEL_FONTS = [
  { id: 'inter', name: 'Inter Bold', url: inter, file: '@fontsource/inter/files/inter-latin-700-normal.woff', note: 'clean sans' },
  {
    id: 'atkinson',
    name: 'Atkinson Hyperlegible Bold',
    url: atkinson,
    file: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff',
    note: 'open shapes, best when small',
  },
  { id: 'nunito', name: 'Nunito ExtraBold', url: nunito, file: '@fontsource/nunito/files/nunito-latin-800-normal.woff', note: 'rounded' },
  {
    id: 'barlow',
    name: 'Barlow Condensed Bold',
    url: barlow,
    file: '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff',
    note: 'narrow, for long names',
  },
  { id: 'robotoslab', name: 'Roboto Slab Bold', url: robotoSlab, file: '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff', note: 'slab serif' },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono Bold',
    url: jetbrains,
    file: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff',
    note: 'monospace, stats line up',
  },
] as const;

export type LabelFontId = (typeof LABEL_FONTS)[number]['id'];

export const labelFont = (id: string) => LABEL_FONTS.find((f) => f.id === id) ?? LABEL_FONTS[0];
