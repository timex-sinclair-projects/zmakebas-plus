# zmakebas+

A browser-based [Sinclair BASIC](https://en.wikipedia.org/wiki/Sinclair_BASIC) editor, validator, and program-file exporter. [Try it out now](https://timex-sinclair-projects.github.io/zmakebas-plus/).

This project is inspired by [zmakebas](https://github.com/ohnosec/zmakebas), the command-line tool that converts Sinclair BASIC text files into Spectrum, Timex/Sinclair, or ZX81 program files. zmakebas is primarily a tokenizer and exporter, so it can produce output for BASIC text files that still contain structural errors. zmakebas+ validates the program before export, so those errors can be caught earlier.

## What It Does

- Validates BASIC as you edit and highlights syntax errors.
- Supports numbered BASIC listings and label mode.
- Shows the generated BASIC listing for label-mode programs.
- Exports Spectrum-family TAP files, ZX Spectrum +3DOS files, and ZX81 P files from the browser.
- Includes a zmakebas compatible command line tool.
- Imports Spectrum-family TAP files and ZX81 P files.
- Runs fully client-side, no backend service is required.

## Relationship To zmakebas

zmakebas intentionally performs little syntax checking and leaves many errors to the target machine. zmakebas+ validates the program structure before export, so it can reject BASIC text that zmakebas might still tokenize.

The input format broadly follows the zmakebas README:

- Keywords are case-insensitive.
- Blank lines and lines beginning with `#` are ignored in label mode.
- A trailing backslash continues a physical input line onto the next line.
- `RAND`/`RANDOMIZE` style aliases are accepted where supported by the lexer.
- Keyword-looking variables are allowed in variable contexts where validation can distinguish them, such as `LET at=0`.
- UDG escapes `\A` through `\U`, block graphics, copyright `\*`, raw byte, literal `@`, and literal backslash escape forms are supported in exported strings and REM text. Imported Spectrum-family TAP strings and REM text use `\*` for © (copyright), and readable block-graphic backslash forms for bytes `128` through `143`, except for block forms ending in a space at the end of REM text where numeric escapes preserve the stored byte. UDG bytes stay as numeric raw-byte escapes so the stored character codes remain visible.
- Spectrum-family display-control escapes are available as readable raw-byte aliases: `\{INK n}` and `\{PAPER n}` use `0..9`; `\{FLASH n}`, `\{BRIGHT n}`, `\{INVERSE n}`, and `\{OVER n}` use `0..1`. These can be used anywhere raw byte escapes can be used, including strings and REM text.
- In ZX81 mode, lowercase letters in the program text follow zmakebas compatibility and export as inverse `A-Z`. Use uppercase text for normal ZX81 letters. Imported ZX81 P files use backslash forms for inverse letters, inverse digits, inverse punctuation, and block graphics where that is roundtrip-safe.

## Differences From zmakebas

These differences are intentional unless noted otherwise:

- zmakebas+ validates syntax before export; invalid BASIC may be rejected even if zmakebas would tokenize it.
- Label references are not substituted inside string literals or REM text. Use `\@` for a literal at-sign if needed.
- Label names are limited to letters, digits, underscore, dot, and hyphen, and must start with a letter, digit, or underscore.
- Label-only lines do not emit BASIC lines; their labels resolve to the next emitted BASIC line. A label at EOF with no following code is ignored.
- ZX Spectrum Next keywords supported by zmakebas are not currently supported by zmakebas+.

## Label Mode

Label mode is enabled by default. It lets you write programs without BASIC line numbers:

```basic
goto @start
print "not seen"
@start: print "hello world"
```

With the default start line `10` and increment `2`, this generates:

```basic
10 GO TO 14
12 PRINT "not seen"
14 PRINT "hello world"
```

You can set the generated start line and increment from the toolbar. You can also pin a generated line number in the listing. Here the line number starts at 9000 and increments by 2:

```basic
9000+2 DATA "Blah"
DATA "Foo"
DATA "Bat"
```

## Exporting

Choose the target dialect before exporting:

- `Spectrum/Timex` exports a TAP file.
- `Spectrum` with the `+3DOS` export format exports a +3DOS-compatible file.
- `ZX81` exports a P file.

The export dialog can optionally set an auto-start line.

## Web Bundle

The [GitHub release](https://github.com/timex-sinclair-projects/zmakebas-plus/releases) includes a static web bundle. Download `zmakebas-plus-web-<tag>.zip` or `zmakebas-plus-web-<tag>.tar.gz`, extract it, and host the contents on any static web server. No backend service is required.

## Command Line

The [GitHub release](https://github.com/timex-sinclair-projects/zmakebas-plus/releases) includes standalone executables for Windows, Linux, and macOS. Download the asset for your platform, extract it, then run the executable. Standalone executables do not require Node.js on the target machine.

```sh
zmakebas [-hlp3rv] [-a line] [-i incr] [-n speccy_filename] [-o output_file] [-s line] [input_file]
zmakebas -o hello.tap hello.bas
```

On Windows, the executable is `zmakebas.exe`:

```powershell
.\zmakebas.exe -o hello.tap hello.bas
```

By default, input is read from stdin and output is written to `out.tap`. Non-ZX81 mode accepts ZX Spectrum, Spectranet, and TS2068 syntax for compatibility with the original `zmakebas` token set. Use `-p` for ZX81 `.p` output, `-l` for label mode, `-r` for raw headerless Spectrum BASIC output, and `-3` for +3DOS output. The command line uses the same stricter validation as the web app, so invalid syntax that original `zmakebas` tokenized loosely may be rejected.

The release also includes a Node CLI bundle. Use that if you prefer to run the JavaScript CLI directly or need a platform-neutral download. It requires [Node.js](https://nodejs.org/en/download):

```sh
node zmakebas.js -o hello.tap hello.bas
```

## Development

Install dependencies:

```sh
npm install
```

Run the development server:

```sh
npm run dev
```

Run checks:

```sh
npm run lint
npm run build
```

Build the static web app locally:

```sh
npm run build:web
```

The local web build is written to `dist-web`.

Build and run the command-line bundle locally:

```sh
npm run build:cli
node dist-cli/zmakebas.js -o hello.tap hello.bas
```

Build and run a standalone executable locally:

```sh
npm run build:exe
./dist-exe/zmakebas -o hello.tap hello.bas
```

On Windows, the local executable path is `dist-exe\zmakebas.exe`:

```powershell
.\dist-exe\zmakebas.exe -o hello.tap hello.bas
```

Local executable builds use Node single executable applications that requires Node.js 26 or newer.

## Project Layout

- `src/parser` contains the lexer, parser, label preprocessor, and program-file exporters.
- `src/cli` contains the Node CLI source.
- `src/components` contains the React UI components.
- `src/hooks` contains the app-level parser, file, and busy-indicator hooks.
- `build-exe.mjs` packages the built CLI as a standalone Node single executable.

