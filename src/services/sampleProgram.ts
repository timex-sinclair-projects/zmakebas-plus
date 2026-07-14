import type { BasicDialect } from '../parser/dialects'

const spectrumSampleProgram = `10 REM Guess the number
20 LET a=INT (RND*100)+1
30 INPUT "Guess the number (1-100)",b
40 IF b=a THEN PRINT "That is correct": STOP
50 IF b<a THEN PRINT "That is too small, try again"
60 IF b>a THEN PRINT "That is too big, try again"
70 GO TO 30`

const zx81SampleProgram = `10 REM GUESS THE NUMBER
20 LET A=INT (RND*100)+1
30 PRINT "GUESS THE NUMBER (1-100)"
40 INPUT B
50 IF B=A THEN PRINT "THAT IS CORRECT"
60 IF B=A THEN STOP
70 IF B<A THEN PRINT "THAT IS TOO SMALL, TRY AGAIN"
80 IF B>A THEN PRINT "THAT IS TOO BIG, TRY AGAIN"
90 GOTO 30`

export function sampleProgramForDialect(dialect: BasicDialect): string {
  return dialect === 'zx81' ? zx81SampleProgram : spectrumSampleProgram
}

export function isBuiltInSampleProgram(source: string): boolean {
  const normalizedSource = normalizeSampleSource(source)
  return normalizedSource === normalizeSampleSource(spectrumSampleProgram) || normalizedSource === normalizeSampleSource(zx81SampleProgram)
}

export function normalizeSampleSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim()
}
