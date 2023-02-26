# Tradingview Strategy Orchestrator
This tool will help you easily test input combinations for your tradingview strategies

for example you can run 200,000 combinations of parameters and get the pnl and statistics within minutes!!
![](https://i.ibb.co/yqpD115/ezgif-5-f3028764a3.gif)


## Description
 - this tool will allow you to define parameter ranges for a given strategy
 - the script will then automatically run every combination of parameters and present a full report of the strategy result for each combo
 - analyze which parameters give the most netProfit or lowest drawdown to meet your preferences

## Instructions
 - create a snippet in your chrome devtools
 - paste the code there
 - run it while on tradingview.com tab
 - results can be accessed in realtime from the `window.reports` object where the key is the study parameters combination
 - use `stop()` in console to stop the simulation

## Dependencies
 - none! this should work on your browser out of the box and uses no 3rd party libraries

 ### acquiring study template :warning: this is the hard part :warning:
  - you will need to populate the study template
  - you can use websocket inspection such as chrome dev-tools network tab to inspect "create_strategy" message for your strategy
  - you can paste the message to the code as-is but you will need to escape \ characters first
  
## Feedback
is greatly appreciated please comment, fork and use (I would appreciate if you tell me which strats and inputs you find to help me retire quicker)

I hope to make further improvements particularly around optimizing solution-space navigation through heuristics such as linear regression and binary search

Shoot me a comment if you know of better ways to skip certain parameter combinations and minimize compute
  
