import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";

const execute = promisify(execFile);

it.each(["America/New_York", "UTC", "Asia/Tokyo", "Pacific/Kiritimati"])(
  "encodes valid local ZIP timestamps at both calendar limits in %s",
  async (timezone) => {
    const module = new URL(
      "../../../../../server/infrastructure/archive/streamSelectionZip.ts",
      import.meta.url,
    ).href;
    const { stdout } = await execute(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
          import { streamSelectionZip } from ${JSON.stringify(module)};
          const entries = [0, Date.UTC(2200, 0, 1), new Date(2024, 5, 15, 10, 20, 30).getTime()]
            .map((modifiedAt, index) => ({path: index + '/', directory: true, size: 0, modifiedAt}));
          const stamps = [];
          for await (const chunk of streamSelectionZip(entries, '', new AbortController().signal)) {
            const signature = chunk.readUInt32LE(0);
            if (signature === 0x04034b50 || signature === 0x02014b50) {
              const offset = signature === 0x04034b50 ? 10 : 12;
              stamps.push([chunk.readUInt16LE(offset), chunk.readUInt16LE(offset + 2)]);
            }
          }
          console.log(JSON.stringify(stamps));
        `,
      ],
      { env: { ...process.env, TZ: timezone } },
    );
    const expected = [
      [0, 33],
      [(23 << 11) | (59 << 5) | 29, (127 << 9) | (12 << 5) | 31],
      [(10 << 11) | (20 << 5) | 15, (44 << 9) | (6 << 5) | 15],
    ];
    expect(JSON.parse(stdout)).toEqual([...expected, ...expected]);
  },
);
