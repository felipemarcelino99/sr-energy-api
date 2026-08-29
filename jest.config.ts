import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
  // Sem limite, o Jest sobe 1 worker ts-jest por núcleo (12 aqui), cada um com
  // seu próprio heap V8 compilando TS — estourou a RAM e travou a máquina.
  maxWorkers: '50%',
  // isolatedModules: cada worker só transpila (sem type-check via Program do
  // TS), que é o que pesa de verdade por worker. O type-check fica pro `tsc
  // --noEmit` rodado à parte (lint/CI), não duplicado em cada processo.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
}

export default config
