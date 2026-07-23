# Selector Stability Report

Generated: 2026-07-23T23:29:12.778Z

## http://127.0.0.1:28440/

| Element | Instances | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- | --- |
| link 'Read more' | 1 | role | role=link[name="Read more"] | Yes | No |
| link 'Read more' | 1 | css | main > article:nth-of-type(1) > a | No | Yes |
| link 'Read more' | 1 | xpath | /html/body/main/article[1]/a | No | Yes |
| link 'Read more' | 1 | role | role=link[name="Read more"] | Yes | No |
| link 'Read more' | 1 | css | main > article:nth-of-type(2) > a | No | Yes |
| link 'Read more' | 1 | xpath | /html/body/main/article[2]/a | No | Yes |

## http://127.0.0.1:28440/article-1

| Element | Instances | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- | --- |
| link 'Back to Blog' | 1 | role | role=link[name="Back to Blog"] | Yes | Yes |
| link 'Back to Blog' | 1 | css | main > a | Yes | Yes |
| link 'Back to Blog' | 1 | xpath | /html/body/main/a | No | Yes |

## http://127.0.0.1:28440/article-2

| Element | Instances | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- | --- |
| link 'Back to Blog' | 1 | role | role=link[name="Back to Blog"] | Yes | Yes |
| link 'Back to Blog' | 1 | css | main > a | Yes | Yes |
| link 'Back to Blog' | 1 | xpath | /html/body/main/a | No | Yes |
