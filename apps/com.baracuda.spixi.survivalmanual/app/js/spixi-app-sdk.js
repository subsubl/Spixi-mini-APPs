// Copyright (C) 2026 IXI Labs
// This file is part of Spixi Mini Apps SDK - https://github.com/ixian-platform/Spixi-Mini-Apps
//
// Spixi Mini Apps SDK is free software: you can redistribute it and/or modify
// it under the terms of the MIT License as published
// by the Open Source Initiative.
//
// Spixi Mini Apps SDK is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// MIT License for more details.

// Spixi Mini Apps SDK

// Command code constants for backend communication
const SPX_CMD_NETWORK_DATA = "ds";
const SPX_CMD_GET_STORAGE = "getStorage";
const SPX_CMD_SET_STORAGE = "setStorage";
const SPX_CMD_SEND_PAYMENT = "sendPayment";

var SpixiAppSdk = {
    version: 0.51,
    date: "2025-12-15",
    _requestId: 0,
    _pendingRequests: {},

    /**
     * Notifies the backend that the app has loaded.
     * Triggers the 'onload' event with the current SDK version.
     */
    fireOnLoad: function () {
        setTimeout(function() {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'spixi-onload', version: SpixiAppSdk.version }, '*');
            }
            try { location.href = "ixian:onload:" + SpixiAppSdk.version; } catch (e) {}
        }, 0);
    },

    /**
     * Requests the backend to navigate back or close the app.
     */
    back: function () {
        setTimeout(function() {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'spixi-back' }, '*');
            }
            try { location.href = "ixian:back"; } catch (e) {}
        }, 0);
    },

    /**
     * Sends data to all remote addresses, optionally to a specific recipient.
     * @param {string} data - Data to send
     * @param {string|null} recipientAddress - Optional recipient address
     */
    sendNetworkData: function (data, recipientAddress = null) {
        var obj = { c: SPX_CMD_NETWORK_DATA, d: data };
        if (recipientAddress) {
            obj.r = recipientAddress;
        }
        SpixiAppSdk.spixiAction(obj, false);
    },
    
    /**
     * Sends protocol-specific data to all remote addresses or optionally to a specific recipient.
     * @param {string} protocolId - Protocol identifier
     * @param {string} data - Data to send
     * @param {string|null} recipientAddress - Optional recipient address
     */
    sendNetworkProtocolData: function (protocolId, data, recipientAddress = null) {
        var obj = { c: SPX_CMD_NETWORK_DATA, pid: protocolId, d: data };
        if (recipientAddress) {
            obj.r = recipientAddress;
        }
        SpixiAppSdk.spixiAction(obj, false);
    },

    /**
     * Retrieves a value from persistent storage.
     * @param {string} table - Storage table name
     * @param {string} key - Key to retrieve
     * @returns {Promise<string|null>} - Decoded value or null if not found
     */
    getStorageData: async function (table, key) {
        const resp = await SpixiAppSdk.spixiAction({ c: SPX_CMD_GET_STORAGE, t: table, k: key }, true);
        if (resp && resp != "null")
        {
            return atob(resp);
        }
        return null;
    },

    /**
     * Stores a value in persistent storage.
     * @param {string} table - Storage table name
     * @param {string} key - Key to set
     * @param {string} value - Value to store
     * @returns {Promise|undefined}
     */
    setStorageData: function (table, key, value) {
        return SpixiAppSdk.spixiAction({ c: SPX_CMD_SET_STORAGE, t: table, k: key, v: btoa(value) }, true);
    },

    /**
     * Sends a payment to a recipient.
     * @param {string} recipientAddress - Address to send payment to
     * @param {number|string} amount - Amount to send
     * @returns {Promise<object>} - Payment result object
     */
    sendPayment: async function (recipientAddress, amount) {
        var data = {
            c: SPX_CMD_SEND_PAYMENT,
            recipients: { }
        };
        data.recipients[recipientAddress] = amount;
        return JSON.parse(await SpixiAppSdk.spixiAction(data, true));
    },

    /**
     * Sends an action to the backend.
     * @param {object} actionData - The action data object to send
     * @param {boolean} useRequestId - Whether to include requestId and await response
     * @returns {Promise|undefined}
     */
    spixiAction: function (actionData, useRequestId = true) {
        if (typeof actionData !== 'object') {
            throw new Error('actionData must be an object');
        }
        let reqId = null;
        let promise;
        if (useRequestId) {
            reqId = ++SpixiAppSdk._requestId;
            actionData.id = reqId;
            promise = new Promise(function(resolve, reject) {
                SpixiAppSdk._pendingRequests[reqId] = { resolve, reject };
            });
        }
        // Serialize and encode actionData
        let json = JSON.stringify(actionData);
        let b64 = btoa(json);
        setTimeout(function() {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'spixi-action', action: actionData, b64: b64 }, '*');
            }
            try { location.href = "xa:" + b64; } catch (e) {}
        }, 0);
        return promise;
    },

    /**
     * Handles backend responses for actions sent with a requestId.
     * @param {string|object} actionResponse - JSON string or object with at least an 'id' property.
     */
    ar: function (actionResponse) {
        try {
            let resp = (typeof actionResponse === 'string') ? JSON.parse(actionResponse) : actionResponse;
            let reqId = resp.id;
            let pendingRequest = SpixiAppSdk._pendingRequests[reqId];
            if (reqId && pendingRequest) {
                if (resp.e) {
                    pendingRequest.reject(resp.e);
                } else {
                    pendingRequest.resolve(resp.r);
                }
                delete SpixiAppSdk._pendingRequests[reqId];
            }
        } catch (e) {
            console.error('SpixiAppSdk.ar error:', e);
        }
    },

    // Handlers to be overridden by app logic
    onInit: function (sessionId, userAddress, ...remoteAddresses) {},
    onNetworkData: function (senderAddress, data) {},
    onNetworkProtocolData: function (senderAddress, protocolId, data) {},
    onRequestAccept: function (data) {},
    onRequestReject: function (data) {},
    onAppEndSession: function (data) {},
    onTransactionReceived: function (senderAddress, amount, txid, data, verified) {},
    onPaymentSent: function (recipientAddress, amount, txid, data, verified) {},
};

// Simulator bridge event listener
if (typeof window !== 'undefined') {
    window.addEventListener('message', function(event) {
        if (!event.data || typeof event.data !== 'object') return;
        const data = event.data;
        if (data.type === 'spixi-sim-init') {
            if (typeof SpixiAppSdk.onInit === 'function') {
                SpixiAppSdk.onInit(data.sessionId, data.userAddress, ...(data.remoteAddresses || []));
            }
        } else if (data.type === 'spixi-sim-network-data') {
            if (typeof SpixiAppSdk.onNetworkData === 'function') {
                SpixiAppSdk.onNetworkData(data.senderAddress, data.data);
            }
        } else if (data.type === 'spixi-sim-protocol-data') {
            if (typeof SpixiAppSdk.onNetworkProtocolData === 'function') {
                SpixiAppSdk.onNetworkProtocolData(data.senderAddress, data.protocolId, data.data);
            }
        } else if (data.type === 'spixi-sim-action-response') {
            SpixiAppSdk.ar(data.response);
        } else if (data.type === 'spixi-sim-transaction') {
            if (typeof SpixiAppSdk.onTransactionReceived === 'function') {
                SpixiAppSdk.onTransactionReceived(data.senderAddress, data.amount, data.txid, data.data, data.verified);
            }
        }
    });
}
