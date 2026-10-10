// import { setContext } from 'svelte';

const serviceWorkerComm = {
  messageChannel: new MessageChannel(),
  onMessageType: new Map(),
  controller: navigator.serviceWorker?.controller,
  postData(data = {}) {
    // console.log('try to post message:', data);
    if (this.controller) {
      this.controller.postMessage(data);
      return true;
    } else {
      console.error(
        "Service workers are not started, could not send data:",
        data,
      );
      // toasts.addToast('Service workers are not started, could not send message:);
      return false;
    }
    // messageChannel.port2.postMessage({type: 'MESSAGE', payload: data});
    // this.controller &&	console.log('sent message:', data);
  },
  /**
   * @param {any} payload
   */
  postMessage(payload) {
    this.postData({ type: "MESSAGE", payload });
  },
};

serviceWorkerComm.onMessageType.set("", (/** @type {object} */ data) =>
  console.log("Data received, no Type defined!", JSON.stringify(data)),
);

serviceWorkerComm.onMessageType.set("MESSAGE", (/** @type {any} */ payload) =>
  console.log(
    "MESSAGE received, no Message type defined!",
    JSON.stringify(payload),
  ),
);

// setContext('serviceWorkerComm', serviceWorkerComm);

//Init port
// console.log('Appp startup hooks');
if (serviceWorkerComm.controller) {
  console.log("Service workers are started", navigator.serviceWorker);
  // navigator.serviceWorker.controller.postMessage({ type: 'PORT_INITIALIZATION' }, [
  // 	messageChannel.port2
  // ]);
  // serviceWorkerComm.messageChannel.port1.onmessage = (event) => {
  // 	const { data, ports } = event;
  // 	if (data?.type === 'MESSAGE')
  // 		console.log('Message received', data); //
  // 	// data.payload && toasts.addToast(data.payload);
  // 	else console.log('Unknown Message', event);
  // };
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { data } = event;

    const fun = serviceWorkerComm.onMessageType.get(
      serviceWorkerComm.onMessageType.has(data?.type) ? data?.type : "",
    );
    fun && fun(data?.type === "MESSAGE" ? data?.payload : data);
    // data.payload && toasts.addToast(data.payload);
    // else console.log('Message', event);
  });
} else console.error("Service workers are not started.");

// /**
//  * @param {object} data
//  */
// function postData(data) { // object need to include the type: field!
// 	console.log('try to post data:', data);
// 	if (navigator.serviceWorker?.controller) {
// 		navigator.serviceWorker.controller.postMessage(data);
// 		// messageChannel.port2.postMessage({type: 'MESSAGE', payload: data});
// 		console.log('sent data:', data);
// 	}
// }

// /**
//  * @param {any} payload
//  */
// function postMessage(payload) {
// 	console.log('try to post message:', payload);
// 	if (navigator.serviceWorker?.controller) {
// 		navigator.serviceWorker.controller.postMessage({ type: 'MESSAGE', payload});
// 		// messageChannel.port2.postMessage({type: 'MESSAGE', payload: data});
// 		console.log('sent message:', payload);
// 	}
// }

const postMessage = serviceWorkerComm.postMessage.bind(serviceWorkerComm);
const postData = serviceWorkerComm.postData.bind(serviceWorkerComm);

export { serviceWorkerComm, postMessage, postData };
