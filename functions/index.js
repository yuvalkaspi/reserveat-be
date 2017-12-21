// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const moment = require('moment');

const dateFormat = "YYYY/MM/DD HH:mm";

exports.notifyOnPickedReservation = functions.database.ref('/users/{uid}/pickedReservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
        const userId = reservation.uid;
        const restaurant = reservation.restaurant;

        const notification = {
                title: "Reservation has been picked up!",
                body: "Your reservation to " + restaurant + " has been picked up!",
            };
        
        return sendNotification(userId, notification)
            	.then(results => {
                    console.log("notifyOnPickedReservation Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnPickedReservation finished with error:", error);
                });
    });



exports.notifyOnMatch = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
        const userIdReservation = reservation.uid;
        const restaurantReservation = reservation.restaurant;
        const dateReservation = moment(reservation.date, dateFormat);
        const numOfPeopleReservation = reservation.numOfPeople;
		const notificationsPromises = [];

		const minDateStr = dateReservation.clone().subtract(2,'hours').format(dateFormat);
		const maxDateStr = dateReservation.clone().add(2,'hours').format(dateFormat);
		
        const notification = {
                title: "It's a match!",
                body: "New reservation matching your request was arrived",
       		};

        return admin.database().ref('/notificationRequests')
    			.orderByChild('date')
    			.startAt(minDateStr)
    			.endAt(maxDateStr)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(notificationReqSnap => {
  						const notificationReq = notificationReqSnap.val();
  						const userId = notificationReq.uid;
  						const isFlexible = notificationReq.isFlexible;
  						const dateMatch = true;
  						if(!isFlexible) {
							dateMatch = dateReservation.format(dateFormat) == notificationReq.date;
  						}
  						const restaurantMatch = restaurantReservation == notificationReq.restaurant;
  						const numOfPeopleMatch = numOfPeopleReservation == notificationReq.numOfPeople;
  						const result = dateMatch && restaurantMatch && numOfPeopleMatch;
  						if(result){
  							console.log("found a match! , reservation of userId: ", userId);
  							notificationsPromises.push(sendNotification(userId, notification));
  						}
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnMatch Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnMatch finished with error:", error);
                });

    });



exports.moveReservationsToHistoryCron = functions.https.onRequest((req,res) => {

	const latestDateToMove = moment().add(2,'hours').add(30,'minutes').format(dateFormat); //2 hours difference between server to local time
	console.log("Moving to history reservations before: ", latestDateToMove);

	return moveOldItemsToHistory('/reservations', '/historyReservations', latestDateToMove)
				.then(results => {
					res.send('OK');
                    console.log("moveReservationsToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("moveReservationsToHistoryCron finished with error:", error);
                });
});



exports.moveNotificationRequestsToHistoryCron = functions.https.onRequest((req,res) => {

	const latestDateToMove = moment().add(2,'hours').add(30,'minutes').format(dateFormat); //2 hours difference between server to local time
	const promises = [];
	console.log("Moving to history notification requests before: ", latestDateToMove);

	return moveOldItemsToHistory('/notificationRequests', 'historyNotificationRequests', latestDateToMove)
				.then(results => {
					res.send('OK');
                    console.log("moveNotificationRequestsToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("moveNotificationRequestsToHistoryCron finished with error:", error);
                });
});




const moveOldItemsToHistory = (refToRemove, refToAdd, latestDateToMove) => {

	const promises = [];

	return admin.database().ref(refToRemove)
    			.orderByChild('date')
    			.endAt(latestDateToMove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(itemSnap => {
  						const item = itemSnap.val();
  						const key = itemSnap.key;
  						promises.push(admin.database().ref(refToRemove + '/' + key).set(null));
  						promises.push(admin.database().ref(refToAdd + '/' + key).set(item));
  					});
  					console.log("Num of items moving to history: ", promises.length/2);
					return Promise.all(promises);
				})	
};




const sendNotification = (userId, notification) => {

	 const payload = {} ;
	 payload['notification'] = notification;

	return admin.database().ref(`/users/${userId}/instanceId`)
        		.once('value')
        		.then(result => {
            		const instanceId = result.val();
            		return admin.messaging().sendToDevice(instanceId, payload);
            	})
};






