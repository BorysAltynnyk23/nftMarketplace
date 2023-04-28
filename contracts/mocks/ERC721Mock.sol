// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract ERC721Mock is ERC721 {

    constructor() ERC721("Mock token", "MOCKTKN"){

    }

    function mint(address _user, uint256 _tokenId) external{
        _mint(_user, _tokenId);
    }

}
