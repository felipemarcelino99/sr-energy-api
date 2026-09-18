import { isValidCPF } from '@/utils/cpf'

describe('isValidCPF', () => {
  it('aceita CPF válido com máscara', () => {
    expect(isValidCPF('111.444.777-35')).toBe(true)
  })

  it('aceita CPF válido sem máscara', () => {
    expect(isValidCPF('52998224725')).toBe(true)
  })

  it('rejeita dígitos verificadores incorretos', () => {
    expect(isValidCPF('111.444.777-36')).toBe(false)
  })

  it('rejeita sequência de dígito repetido (passaria no cálculo, mas nunca é emitido)', () => {
    expect(isValidCPF('000.000.000-00')).toBe(false)
    expect(isValidCPF('11111111111')).toBe(false)
  })

  it('rejeita string com tamanho diferente de 11 dígitos', () => {
    expect(isValidCPF('123.456.789')).toBe(false)
    expect(isValidCPF('123.456.789-000')).toBe(false)
  })

  it('rejeita string vazia ou não numérica', () => {
    expect(isValidCPF('')).toBe(false)
    expect(isValidCPF('abc.def.ghi-jk')).toBe(false)
  })
})
