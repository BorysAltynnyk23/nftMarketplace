// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {

    constructor() ERC20("Mock token", "MOCKTKN"){

    }

    function mint(address _user, uint256 _amount) external{
        _mint(_user, _amount);
    }

}
