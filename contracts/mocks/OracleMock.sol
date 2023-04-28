// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract OracleMock{
    int256 public price = 1e8; // 1 usd

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ){
            roundId = 0;
            answer = price;
            startedAt = 0;
            updatedAt = 0;
            answeredInRound = 0;

        }

    function setPrice(int256 _price) public {
        price = _price;
    }


}
