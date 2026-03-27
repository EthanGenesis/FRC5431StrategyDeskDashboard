import { describe, expect, it } from 'vitest';

import { decodeGameManualBuffer, parseGameManualHtml } from './game-manual';

const MANUAL_FIXTURE = `
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=macintosh" />
  </head>
  <body>
    <p class="MsoToc1"><a href="#_Toc1">1 Introduction</a></p>
    <p class="MsoToc2"><a href="#_Toc2">1.1 Arena</a></p>
    <h1><a name="_Toc1"></a>1 Introduction</h1>
    <p>Welcome to the manual.</p>
    <p><img src="2026GameManual_files/image001.jpg" alt="Field image" /></p>
    <h2><a name="_Toc2"></a>1.1 Arena</h2>
    <p>The ARENA has dimensions.</p>
  </body>
</html>
`;

describe('game-manual helpers', () => {
  it('decodes macintosh-encoded buffers', () => {
    const decoded = decodeGameManualBuffer(Uint8Array.from([0x54, 0x8e, 0x73, 0x74]).buffer);

    expect(decoded).toBe('Tést');
  });

  it('parses sections, TOC entries, and rewrites relative assets', () => {
    const snapshot = parseGameManualHtml(MANUAL_FIXTURE, 'Tue, 24 Mar 2026 21:46:05 GMT');

    expect(snapshot.title).toBe('2026 FRC Game Manual');
    expect(snapshot.sections).toHaveLength(2);
    expect(snapshot.toc).toEqual([
      { id: '_Toc1', title: '1 Introduction', number: '1', level: 1 },
      { id: '_Toc2', title: '1.1 Arena', number: '1.1', level: 2 },
    ]);
    expect(snapshot.sections[0]?.html).toContain(
      'https://firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual_files/image001.jpg',
    );
    expect(snapshot.sections[1]?.text).toContain('ARENA has dimensions');
  });
});
