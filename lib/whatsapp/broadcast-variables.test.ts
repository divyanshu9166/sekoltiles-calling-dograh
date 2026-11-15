import { describe, expect, it } from 'vitest'
import {
  blankVariables,
  blankVariablesReason,
  describeMapping,
  resolveVariables,
  variableKeys,
  type VariableMapping,
} from './broadcast-variables'

const variables: Record<string, VariableMapping> = {
  '10': { type: 'static', value: 'Diwali' },
  '2': { type: 'field', value: 'email' },
  '1': { type: 'field', value: 'name' },
  '3': { type: 'custom_field', value: 'f-city' },
}

describe('broadcast variables', () => {
  it('orders {{n}} numerically and finds the empty ones for a contact', () => {
    expect(variableKeys(variables)).toEqual(['1', '2', '3', '10'])
    const params = resolveVariables(variables, { name: 'TAO MARBLES', email: '  ' }, { 'f-city': 'Patna' })
    expect(params).toEqual(['TAO MARBLES', '  ', 'Patna', 'Diwali'])
    expect(blankVariables(variables, params)).toEqual(['2'])
    expect(blankVariables(variables, resolveVariables(variables, { name: 'X', email: 'a@b.c' }, {}))).toEqual(['3'])
  })

  it('explains where an empty value came from', () => {
    expect(describeMapping({ type: 'field', value: 'company' })).toBe('Contact field: Company')
    expect(describeMapping({ type: 'custom_field', value: 'f-city' }, 'City')).toBe('Custom field: City')
    expect(describeMapping({ type: 'static', value: '' })).toBe('Static value')
    expect(blankVariablesReason(variables, ['2'])).toMatch(/^Not sent: \{\{2\}\} \(Contact field: Email Address\) is empty/)
  })
})
