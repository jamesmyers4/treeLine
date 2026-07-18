import { describe, expect, it } from 'vitest'
import { categorizeRequestBodyContentType } from './capture.js'

describe('categorizeRequestBodyContentType', () => {
  it('categorizes a bare application/json content type as json', () => {
    expect(categorizeRequestBodyContentType('application/json')).toBe('json')
  })

  it('categorizes application/json with a charset parameter as json', () => {
    expect(categorizeRequestBodyContentType('application/json; charset=UTF-8')).toBe('json')
  })

  it('categorizes a bare application/x-www-form-urlencoded content type as form-urlencoded', () => {
    expect(categorizeRequestBodyContentType('application/x-www-form-urlencoded')).toBe('form-urlencoded')
  })

  it('categorizes application/x-www-form-urlencoded with a charset parameter as form-urlencoded', () => {
    expect(categorizeRequestBodyContentType('application/x-www-form-urlencoded; charset=UTF-8')).toBe('form-urlencoded')
  })

  it('categorizes a multipart/form-data content type with a boundary parameter as multipart', () => {
    expect(categorizeRequestBodyContentType('multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW')).toBe('multipart')
  })

  it('categorizes a genuinely unrecognized content type as other', () => {
    expect(categorizeRequestBodyContentType('text/plain')).toBe('other')
  })

  it('categorizes an empty content type as other', () => {
    expect(categorizeRequestBodyContentType('')).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(categorizeRequestBodyContentType('APPLICATION/JSON')).toBe('json')
  })
})
