# Toncli-based tests

To run tests, you need version of toncli from [here](https://github.com/BorysMinaiev/toncli/tree/run-tests-refactoring), and version of fift from [here](https://github.com/SpyCheese/ton/tree/toncli-local). See details about this version of toncli-tests [here](https://github.com/BorysMinaiev/toncli/blob/run-tests-refactoring/docs/advanced/func_tests_new.md).

```
mkdir build 
toncli run_tests
```

Expected result:
![image](https://user-images.githubusercontent.com/2011126/166340714-582e0552-93e1-484d-bdfb-7057858432bc.png)

Each test:
1. registers N nominators
2. sends deposit from validator
3. sends stake to the elector
4. waits until validators set is updated 3 times
5. sends recover stake query
6. receives money from elector
7. each nominator with probability 50% withdraws money


Each test result contains 7 numbers corresponds to average gas usage per operation of each of 7 types. For example first number is sum of all gas spend on registering nominators divided by number of nominators.

6-th number (which is around 41M in the last test) is gas used during receiving money from elector (and distributing it).

Tests don't check what messages are sent to elector, only the fact of sending something.
