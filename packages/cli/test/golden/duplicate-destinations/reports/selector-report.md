# Selector Stability Report

Generated: 2026-07-18T21:28:18.268Z

## http://127.0.0.1:45568/

| Element | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- |
| link 'Read more' | role | role=link[name="Read more"] | Yes | No |
| link 'Read more' | css | main > article:nth-of-type(1) > a | No | Yes |
| link 'Read more' | xpath | /html/body/main/article[1]/a | No | Yes |
| link 'Read more' | role | role=link[name="Read more"] | Yes | No |
| link 'Read more' | css | main > article:nth-of-type(2) > a | No | Yes |
| link 'Read more' | xpath | /html/body/main/article[2]/a | No | Yes |

## http://127.0.0.1:45568/article-1

| Element | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- |
| link 'Back to Blog' | role | role=link[name="Back to Blog"] | Yes | Yes |
| link 'Back to Blog' | css | main > a | Yes | Yes |
| link 'Back to Blog' | xpath | /html/body/main/a | No | Yes |

## http://127.0.0.1:45568/article-2

| Element | Strategy | Selector | Stable | Unique |
| --- | --- | --- | --- | --- |
| link 'Back to Blog' | role | role=link[name="Back to Blog"] | Yes | Yes |
| link 'Back to Blog' | css | main > a | Yes | Yes |
| link 'Back to Blog' | xpath | /html/body/main/a | No | Yes |
