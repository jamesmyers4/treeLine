# Selector Stability Report

Generated: 2026-07-09T21:24:07.669Z

## https://example.com/

| Element | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- |
| link 'Learn more' | role | role=link[name="Learn more"] | Yes | Yes |
| link 'Learn more' | css | div > p:nth-of-type(2) > a | No | Yes |
| link 'Learn more' | xpath | /html/body/div/p[2]/a | No | Yes |
